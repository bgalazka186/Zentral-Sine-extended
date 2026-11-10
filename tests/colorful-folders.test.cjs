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
  assert.deepEqual(J(groups), ["Classic yellow folders", "Dark glass", "Sticky notes", "Neon outline", "Dark folders", "High contrast", "Colorful"]);
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
  assert.match(source, /Apply and close/);
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

const F = c.FOLDER_STYLE;
const env = (extra = {}) => ({ mode: "simple", defaults: { b: "#336699", d: {}, o: {} }, layers: {}, ignoreLabel: false, ...extra });
test("a default can never overwrite a folder's own colors, level defaults beat the all-levels default", () => {
  const own = F.resolve({ b: "#aa0000", d: {}, o: {} }, 1, env({ defaults: { b: "#336699", d: { front: "#00ff00" }, o: { back: 10, front: 10 } }, mode: "detailed" }));
  assert.equal(own.from, "folder");
  assert.equal(own.base, "#aa0000");
  assert.ok(!own.parts.front.includes("#00ff00"), "default detail layer does not leak into a styled folder");
  assert.deepEqual(J(own.opacity), {}, "default opacity does not leak either");
  const plain = F.resolve(null, 3, env({ layers: { 3: { b: "#118811", d: {}, o: {} } } }));
  assert.equal(plain.from, "level");
  assert.equal(plain.base, "#118811");
  assert.equal(F.resolve(null, 2, env({ layers: { 3: { b: "#118811", d: {}, o: {} } } })).from, "default");
  assert.equal(F.resolve(null, 1, { mode: "simple" }).from, "none");
  assert.equal(F.resolve(null, 9, env({ layers: { 5: { b: "#118811", d: {}, o: {} } } })).base, "#118811", "levels deeper than 5 use level 5");
});
test("Simple mode: primary + secondary (outline) only; Detailed layers apply only in Detailed mode", () => {
  const record = { b: "#336699", d: { stroke: "#ffcc00", front: "#ffffff" }, o: {} };
  const simple = F.resolve(record, 1, env());
  assert.equal(simple.parts.stroke, "#ffcc00", "secondary color is the outline");
  assert.notEqual(simple.parts.front, "#ffffff", "Simple ignores Detailed layers");
  assert.equal(F.resolve(record, 1, env({ mode: "detailed" })).parts.front, "#ffffff");
  assert.ok(F.contrast("#336699", "#336699") < 1.6 && F.contrast("#000000", "#ffffff") > 20);
});
test("opacity is applied per layer and accent, tint and hover now reach plain properties the stylesheet draws", () => {
  const r = F.resolve({ b: "#336699", d: {}, o: { back: 40, hover: 0 } }, 1, env());
  assert.match(r.properties["--zen-folder-behind-bgcolor"], /40%, transparent\)/);
  assert.match(r.properties["--bgalazka-fc-hover"], /0%, transparent\)/, "0% is a real value");
  for (const p of ["--bgalazka-fc-accent", "--bgalazka-fc-tint", "--bgalazka-fc-hover"]) assert.ok(r.properties[p], p);
  assert.match(source, /zen-folder\[\$\{LAYERS_ATTR\}~="accent"\]/);
  assert.match(source, /zen-folder\[\$\{LAYERS_ATTR\}~="hover"\] > \.tab-group-label-container:hover/);
});
test("ignore-label option removes only our label color", () => {
  const on = F.resolve({ b: "#336699", d: {}, o: {} }, 1, env({ ignoreLabel: true }));
  assert.equal(on.properties["--bgalazka-fc-label"], undefined);
  assert.ok(on.properties["--zen-folder-stroke"]);
  assert.ok(F.resolve({ b: "#336699", d: {}, o: {} }, 1, env()).properties["--bgalazka-fc-label"]);
});
test("level defaults serialize safely and a collection spreads over levels 1-5", () => {
  const raw = F.serializeLayers({ 1: { b: "#112233", d: { stroke: "#ffffff" }, o: { back: 50 } }, 2: { b: "nope", d: {}, o: {} }, 9: { b: "#112233" } });
  const parsed = F.parseLayers(raw);
  assert.deepEqual(J(Object.keys(parsed)), ["1"]);
  assert.deepEqual(J(F.parseLayers("{bad")), {});
  assert.deepEqual(J(F.parseLayers("x".repeat(40000))), {});
  const group = c.BUILTIN_THEMES.find((g) => g.group === "Classic yellow folders");
  const spread = F.spreadCollection(group);
  assert.deepEqual(J(Object.keys(spread)), ["1", "2", "3", "4", "5"]);
  assert.equal(spread[1].b, group.items[0].b);
  const short = F.spreadCollection({ items: [{ b: "#111111" }, { b: "#222222" }] });
  assert.equal(short[3].b, "#111111", "a short collection cycles");
  assert.equal(F.needsDetailed({ b: "#111111", d: { stroke: "#ffffff" } }), false);
  assert.equal(F.needsDetailed({ b: "#111111", d: { front: "#ffffff" } }), true);
});
test("collections: three themed families with five looks each, every look valid; yellow and neon families are distinct", () => {
  for (const name of ["Classic yellow folders", "Dark glass", "Sticky notes", "Neon outline"]) {
    const group = c.BUILTIN_THEMES.find((g) => g.group === name);
    assert.ok(group && group.items.length === 5, name);
    assert.ok(group.items.every((look) => c.cleanTheme(look)), name + " looks validate");
  }
  const glass = c.BUILTIN_THEMES.find((g) => g.group === "Dark glass");
  assert.ok(glass.items.every((look) => look.o.back < 100 && F.contrast(look.b, look.d.stroke) >= 3), "semi-transparent with a contrasty but not white outline");
  assert.ok(glass.items.every((look) => F.lum(look.d.stroke) < 0.6));
});
test("element depth counts zen-folder ancestors", () => {
  const mk = (parent) => ({ localName: "zen-folder", parentElement: parent || null });
  const a = mk(), b = mk(a), cc = mk(b);
  assert.equal(F.elementDepth(a), 1);
  assert.equal(F.elementDepth(cc), 3);
});
test("Colorful Folders and Notes carry the identical style core, and Notes root style no longer calls a controller-only helper", () => {
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
  const block = (text) => {
    const i = text.indexOf("// <<FOLDER-STYLE-CORE");
    const j = text.indexOf("// FOLDER-STYLE-CORE>>");
    assert.ok(i >= 0 && j > i);
    return text.slice(i, j).split("\n").map((l) => l.trim()).join("\n");
  };
  const notes = read("additional/notes/ZentralNotes.uc.js");
  assert.equal(block(notes), block(source), "same text in both files");
  const standalone = read("additional/folders/ZentralColorfulFolders.standalone.uc.js");
  assert.equal(block(standalone), block(source), "the Sine bundle carries the same core");
  assert.match(notes, /const prefStr = \(k, d\) => String\(getPref\(k, d\) \?\? d\);/);
  assert.match(notes, /function buildRootRow\(\)/);
  assert.match(notes, /chip\("Apply and close", true\)/);
  assert.match(notes, /onFolderMenuShowing/);
});
test("new preferences are declared for the full mod and the standalone package", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, "additional/folders/settings.json"), "utf8"));
  assert.ok(schema.schema.some((item) => item.property.endsWith("folder_colors.ignore_label") && item.defaultValue === false));
  const standalone = JSON.parse(fs.readFileSync(path.join(root, "additional/folders/standalone.json"), "utf8"));
  assert.ok(standalone.externalPrefs.includes("zen.workspace.zentral.folder_colors.default_layers"));
  assert.ok(standalone.preferenceOrder.includes("zen.workspace.zentral.folder_colors.ignore_label"));
});
console.log(`\n${passed} Colorful Folders tests passed`);
