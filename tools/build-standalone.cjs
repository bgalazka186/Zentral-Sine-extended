#!/usr/bin/env node
/* Build Sine-installable standalone packages from additional/<module>/standalone.json.
 *
 * Output goes NEXT TO the source so Sine can be pointed at the module folder:
 *   <dir>/theme.json, <dir>/preferences.json, <dir>/<output>.uc.js, <dir>/standalone.lock.json
 *
 * Usage: node tools/build-standalone.cjs [--check] [--bump]
 *   --check  build in memory, fail if committed files differ (CI / pre-commit)
 *   --bump   if content changed but version did not, raise the patch version
 *
 * Rules enforced:
 *  - content changed => version must change (Sine updates by version);
 *  - the source may only use runtime APIs the shim provides;
 *  - sidebar helpers are copied from loader/ZentralRuntime.js, never retyped.
 */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  vm = require("node:vm");
const root = path.resolve(__dirname, ".."),
  args = new Set(process.argv.slice(2));
const SHIM = path.join(root, "loader/standalone/ZentralStandaloneShim.js"),
  RUNTIME = path.join(root, "loader/ZentralRuntime.js");
const SIDEBAR_FUNCTIONS = [
  "nativeSidebarElement",
  "nativeSidebarRect",
  "nativeSidebarSide",
];
// Runtime members the shim implements. Anything else a module touches is an error.
const PROVIDED = new Set([
  "register",
  "registerSettingsHook",
  "ensureSettingsSection",
  "registerHostUnload",
  "nativeSidebarElement",
  "nativeSidebarRect",
  "nativeSidebarSide",
  "getPref",
  "standalone",
  "sidebarLayoutRepair",
  "compactHoverStatus",
]);

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) =>
      d.name === "node_modules" || d.name === ".git"
        ? []
        : d.isDirectory()
          ? walk(path.join(dir, d.name))
          : [path.join(dir, d.name)],
    );
}
// Copy `function name(...) {...}` verbatim with a string/comment-aware brace scan.
function extractFunction(source, name) {
  const start = source.indexOf("function " + name + "(");
  if (start < 0) throw new Error("Runtime function not found: " + name);
  let i = source.indexOf("{", source.indexOf(")", start)),
    depth = 0;
  const begin = i;
  for (; i < source.length; i++) {
    const c = source[i],
      n = source[i + 1];
    if (c === "/" && n === "/") i = source.indexOf("\n", i);
    else if (c === "/" && n === "*") i = source.indexOf("*/", i) + 1;
    else if (c === '"' || c === "'" || c === "`") {
      for (i++; source[i] !== c; i++) if (source[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) break;
  }
  if (depth !== 0) throw new Error("Unbalanced braces in " + name);
  const text = source.slice(start, i + 1);
  return text.slice(0, text.indexOf("{")) + source.slice(begin, i + 1);
}
// Settings schemas live next to their owners. A standalone package must ship every
// preference its source reads, so each one is either owned by the module, borrowed
// from its real owner (copied, never retyped), or declared external (native Zen or
// another mod's pref). Anything else is a hidden dependency and fails the build.
const PREF_PATTERN =
  /["'`]((?:zen\.|browser\.|arc-|zentral\.|extensions\.|sine\.|layout\.|widget\.|toolkit\.|ui\.)[A-Za-z0-9_.\-]+)["'`]/g;
function schemaOwners() {
  const owners = new Map();
  for (const file of walk(root)) {
    if (!/(^|[\\/])(extension-)?settings\.json$/.test(file) || file.includes("upstream"))
      continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (_) {
      continue;
    }
    for (const entry of json.schema || []) {
      if (!owners.has(entry.property)) owners.set(entry.property, []);
      owners.get(entry.property).push({ file, entry });
    }
  }
  return owners;
}
function usedRuntimeMembers(source) {
  const used = new Set();
  const re =
    /(?:window\.ZentralRuntime|window\.__zentralStandaloneRuntime|\bZentralRuntime|\bhostRuntime|\bruntime)\)?\??\.([A-Za-z_]+)/g;
  for (let m; (m = re.exec(source)); ) used.add(m[1]);
  return used;
}
const { toSinePrefs, numericList } = require("./lib/sine-prefs.cjs");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";

function build(manifestFile) {
  const dir = path.dirname(manifestFile);
  const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  for (const key of ["id", "themeId", "version", "entry", "output"])
    if (!m[key]) throw new Error(`${manifestFile}: missing "${key}"`);
  if (!/^\d+\.\d+\.\d+$/.test(m.version))
    throw new Error(`${manifestFile}: version must be x.y.z`);
  const rel = (file) => path.relative(root, path.join(dir, file)).split(path.sep).join("/");
  const read = (file) => fs.readFileSync(path.join(dir, file), "utf8");
  // Multi-file modules ("loader" set): controllers are embedded as functions keyed by
  // their repo path, content helpers as strings, extras run inside the same
  // feature lifecycle, and "assets" stay real files that Gecko itself must read.
  const loaderGlobal = m.loader || null;
  if (loaderGlobal && !/^__[A-Za-z0-9]+$/.test(loaderGlobal))
    throw new Error(`${m.id}: "loader" must be a private global like __zentralVideoLoader`);
  if (!loaderGlobal && (m.include || m.texts || m.extras))
    throw new Error(`${m.id}: include/texts/extras need "loader"`);
  const replacements = new Map();
  for (const r of m.replacements || []) {
    if (!replacements.has(r.file)) replacements.set(r.file, []);
    replacements.get(r.file).push(r);
  }
  const prepare = (file) => {
    let text = read(file);
    for (const r of replacements.get(file) || []) {
      if (text.split(r.from).length !== 2)
        throw new Error(`${m.id}: replacement in ${file} must match exactly once: ${r.from}`);
      text = text.replace(r.from, () => r.to);
    }
    if (loaderGlobal) text = text.split("window.ZentralModuleLoader").join("window." + loaderGlobal);
    return text;
  };
  const source = prepare(m.entry);
  const included = Object.fromEntries((m.include || []).map((f) => [rel(f), prepare(f)]));
  const textFiles = Object.fromEntries((m.texts || []).map((f) => [rel(f), read(f)]));
  const extras = (m.extras || []).map((f) => ({ file: f, text: prepare(f) }));
  for (const asset of m.assets || [])
    if (!fs.existsSync(path.join(dir, asset)))
      throw new Error(`${m.id}: asset ${asset} must exist next to the module`);
  for (const [file, text] of [
    [m.entry, source],
    ...Object.entries(included),
    ...extras.map((e) => [e.file, e.text]),
  ]) {
    if (/ZentralModuleLoader/.test(text))
      throw new Error(`${m.id}: ${file} still names the full pack's module loader`);
    try {
      // Syntax check only; nothing is executed. Controllers become function bodies.
      new vm.Script(`(function (window) {\n${text}\n})`, { filename: file });
    } catch (error) {
      throw new Error(`${m.id}: ${file} does not parse as an embedded source: ${error.message}`);
    }
  }
  const allSources = [source, ...Object.values(included), ...extras.map((e) => e.text)];
  const allText = allSources.join("\n");
  // Members a module only touches when the full pack is present (guarded in
  // the source). Declared per manifest so every exception is visible.
  const fullOnly = new Set(m.fullPackOnly || []);
  const bad = [...usedRuntimeMembers(allText)].filter(
    (x) => !PROVIDED.has(x) && !fullOnly.has(x),
  );
  if (bad.length)
    throw new Error(
      `${m.id}: uses runtime APIs the standalone shim does not provide: ${bad.join(", ")}. ` +
        "Extend the shim (and its tests) or keep this module full-pack only.",
    );
  // The lifecycle scope is supported (copied verbatim). The full pack's module
  // loader is not: multi-file modules declare "loader" and get an embedded one.
  if (!loaderGlobal && /ZentralModuleLoader/.test(allText))
    throw new Error(
      `${m.id}: depends on the module loader; declare "loader" with include/texts, or keep it full-pack only (see docs/SINE-MODULAR-INSTALL.md).`,
    );
  if (/window\.Zentral\b/.test(allText))
    throw new Error(`${m.id}: reads window.Zentral (the full pack's UI namespace); not standalone-ready.`);
  if (/\b(shared|services)\b\s*[,}]\s*(?:=\s*\{\})?\s*\)\s*\{/.test(allText))
    throw new Error(
      `${m.id}: init destructures shared/services, which the shim does not provide.`,
    );

  const runtimeSource = fs.readFileSync(RUNTIME, "utf8");
  const sidebar = SIDEBAR_FUNCTIONS.map((n) =>
    extractFunction(runtimeSource, n),
  ).join("\n");
  const scopeFns = extractFunction(runtimeSource, "createFeatureScope");
  let shim = fs.readFileSync(SHIM, "utf8");
  if (!shim.includes("/*__SIDEBAR_FUNCTIONS__*/"))
    throw new Error("Shim is missing the sidebar marker");
  if (!shim.includes("/*__SCOPE_FUNCTIONS__*/"))
    throw new Error("Shim is missing the scope marker");
  if (!shim.includes("/*__NUMERIC_FUNCTIONS__*/"))
    throw new Error("Shim is missing the numeric marker");
  shim = shim.replace("/*__NUMERIC_FUNCTIONS__*/", () =>
    extractFunction(runtimeSource, "createNumericPrefSync"),
  );
  shim = shim.replace("/*__SIDEBAR_FUNCTIONS__*/", () => sidebar);
  shim = shim.replace("/*__SCOPE_FUNCTIONS__*/", () => scopeFns);
  // Version comes from the manifest at build time; the shim only reports it.

  let css = "";
  if (m.css) css = fs.readFileSync(path.join(dir, m.css), "utf8");

  const schemaFile = m.settings && path.join(dir, m.settings);
  const ownSchema = schemaFile
    ? JSON.parse(fs.readFileSync(schemaFile, "utf8")).schema
    : [];
  if (!Array.isArray(ownSchema))
    throw new Error(`${m.id}: settings has no schema`);
  const owners = schemaOwners();
  const borrowed = [];
  for (const b of m.borrowedSettings || []) {
    for (const property of b.properties) {
      const found = (owners.get(property) || []).find(
        (o) => path.relative(root, o.file).split(path.sep).join("/") === b.from,
      );
      if (!found)
        throw new Error(`${m.id}: borrowed pref ${property} not found in ${b.from}`);
      borrowed.push(found.entry);
    }
  }
  const byProperty = new Map(
    [...ownSchema, ...borrowed].map((entry) => [entry.property, entry]),
  );
  if (byProperty.size !== ownSchema.length + borrowed.length)
    throw new Error(`${m.id}: a pref is both owned and borrowed, or listed twice`);
  // preferenceOrder may interleave own and borrowed prefs and add Sine heading
  // items ({type:"text", ...}); every pref must appear exactly once.
  let prefs;
  if (m.preferenceOrder) {
    prefs = m.preferenceOrder.map((item) => {
      if (typeof item !== "string") return item;
      const entry = byProperty.get(item);
      if (!entry) throw new Error(`${m.id}: preferenceOrder names unknown pref ${item}`);
      return entry;
    });
    const placed = prefs.filter((p) => p.property).map((p) => p.property);
    const missing = [...byProperty.keys()].filter((k) => !placed.includes(k));
    if (missing.length || new Set(placed).size !== placed.length)
      throw new Error(`${m.id}: preferenceOrder must list every pref once (missing: ${missing.join(", ") || "none"})`);
  } else prefs = [...ownSchema, ...borrowed];
  // Prefs that only mean something with a full-pack subsystem are not shipped.
  // The list is explicit and carries its reason, so nothing disappears silently.
  const excluded = new Set((m.excludePrefs && m.excludePrefs.properties) || []);
  for (const property of excluded)
    if (!byProperty.has(property))
      throw new Error(`${m.id}: excludePrefs names unknown pref ${property}`);
  if (excluded.size && !m.excludePrefs.reason)
    throw new Error(`${m.id}: excludePrefs needs a "reason"`);
  prefs = prefs.filter((p) => !p.property || !excluded.has(p.property));
  // Internal schema entries (with numeric ranges) are kept for the sync list; Sine gets the converted view.
  const numericItems = numericList(prefs);
  const internalPrefs = prefs;
  prefs = toSinePrefs(prefs);
  const allowedPrefs = new Set([
    ...byProperty.keys(),
    ...(m.externalPrefs || []),
  ]);
  for (const pref of new Set(allSources.flatMap((text) => [...text.matchAll(PREF_PATTERN)].map((x) => x[1])))) {
    if (pref.endsWith(".")) continue; // a prefix used to build keys, not a pref
    if (allowedPrefs.has(pref)) continue;
    const elsewhere = owners.get(pref);
    throw new Error(
      elsewhere
        ? `${m.id}: reads ${pref}, owned by ${path.relative(root, elsewhere[0].file)}. Add it to "borrowedSettings" so the package ships its option.`
        : `${m.id}: reads ${pref}, which no settings file owns. If it is a native Zen pref or another mod's, list it in "externalPrefs".`,
    );
  }

  // Multi-file part: embedded loader, embedded sources and the feature wrapper.
  let loaderPart = "",
    wrapPart = "";
  if (loaderGlobal) {
    const template = fs.readFileSync(path.join(root, "loader/standalone/ZentralStandaloneLoader.js"), "utf8");
    for (const marker of ["/*__SOURCES__*/", "/*__TEXTS__*/"])
      if (!template.includes(marker)) throw new Error("Loader template is missing " + marker);
    // Each controller is real code inside a function (eval is blocked in
    // privileged windows), keyed by the repo path the module already uses.
    const sourcesLiteral =
      "{\n" +
      Object.entries(included)
        .map(([file, text]) => `${JSON.stringify(file)}: function (window) {\n${text}\n},`)
        .join("\n") +
      "\n}";
    const textsLiteral = "{\n" + Object.entries(textFiles).map(([file, text]) => `${JSON.stringify(file)}: ${JSON.stringify(text)},`).join("\n") + "\n}";
    loaderPart =
      "const __BUNDLE_URL__ = Components.stack.filename; // install folder, resolved synchronously\n" +
      template
        .replace("/*__SOURCES__*/ {}", () => sourcesLiteral)
        .replace("/*__TEXTS__*/ {}", () => textsLiteral)
        .split("__LOADER_GLOBAL__").join(loaderGlobal) +
      `\nwindow.${loaderGlobal}?.destroy?.(); // live re-run replaces the old instance\nwindow.${loaderGlobal} = __zentralEmbeddedLoader;\n`;
    // The entry registers one feature. Extras start with it and stop with it, and
    // the private loader is released last, so nothing outlives the feature.
    wrapPart =
      "const __zentralExtras = [\n" +
      extras.map((e) => `function (window, runtime, lifecycle) {\n${e.text}\n},`).join("\n") +
      "\n];\n" +
      `const __zentralRegister = __zentralShim.register;\n` +
      `__zentralShim.register = function (def) {\n` +
      `  return __zentralRegister({\n    ...def,\n    init(args) {\n      const stops = [];\n` +
      `      const stopAll = () => {\n        for (const stop of stops.splice(0).reverse()) {\n          try { stop(); } catch (error) { console.warn("[Zentral standalone] cleanup", error); }\n        }\n        __zentralEmbeddedLoader.destroy();\n      };\n` +
      `      try {\n        for (const start of __zentralExtras) {\n          const stop = start(window, args.runtime, args.lifecycle);\n          if (typeof stop === "function") stops.push(stop);\n        }` +
      `        const base = def.init(args);\n        stops.push(typeof base === "function" ? base : () => base?.destroy?.());\n      } catch (error) {\n        stopAll();\n        throw error;\n      }\n      return stopAll;\n    },\n  });\n};\n`;
  }
  const bundleFor = (version) =>
    `// Generated by tools/build-standalone.cjs. DO NOT EDIT; edit ${m.entry} and rebuild.\n` +
    `// ==UserScript==\n// @name ${m.name}\n// @include chrome://browser/content/browser.xhtml\n// @version ${version}\n// ==/UserScript==\n` +
    `(function () {\n  "use strict";\n  // The full pack, when installed, owns this feature.\n  if (window.ZentralRuntime) return;\n` +
    (loaderGlobal ? "  // Resolve the install folder before anything else runs.\n" : "") +
    shim
      .split("__FEATURE_VERSION__")
      .join(version)
      .replace("/*__NUMERIC_ITEMS__*/ []", () => JSON.stringify(numericItems)) +
    `\n${loaderPart}${wrapPart}${source}\n})();\n`;
  const lockFile = path.join(dir, "standalone.lock.json");
  const lock = fs.existsSync(lockFile)
    ? JSON.parse(fs.readFileSync(lockFile, "utf8"))
    : null;
  // Content hash is version-independent so a pure version bump is not "a change".
  const assetText = (m.assets || []).map((a) => read(a)).join("\0");
  const contentHash = sha(bundleFor("0.0.0") + css + json(prefs) + assetText);
  let version = m.version;
  if (lock && lock.hash !== contentHash && lock.version === version) {
    if (!args.has("--bump"))
      throw new Error(
        `${m.id}: content changed but version is still ${version}. ` +
          `Raise "version" in ${path.relative(root, manifestFile)} (or run with --bump), otherwise Sine will not update users.`,
      );
    const [a, b, c] = version.split(".").map(Number);
    version = `${a}.${b}.${c + 1}`;
    m.version = version;
    fs.writeFileSync(manifestFile, json(m));
  }
  const theme = {
    id: m.themeId,
    name: m.name,
    description: m.description,
    homepage: `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/${path.relative(root, dir).split(path.sep).join("/")}`,
    supportsUnload: true,
    style: { chrome: m.css || "", content: "" },
    scripts: {
      [m.output]: {
        include: ["chrome://browser/content/browser.xhtml"],
        loadOrder: 2,
      },
    },
    author: "bgalazka186",
    version,
    preferences: prefs.length ? "preferences.json" : "",
    tags: m.tags || [],
    fork: ["zen"],
    readme: `https://raw.githubusercontent.com/bgalazka186/Zentral-Sine-extended/main/${path.relative(root, dir).split(path.sep).join("/")}/README.md`,
  };
  const outputs = {
    [m.output]: bundleFor(version),
    "theme.json": json(theme),
    "standalone.lock.json": json({ version, hash: contentHash }),
  };
  if (prefs.length) outputs["preferences.json"] = json(prefs);
  return { dir, id: m.id, outputs };
}

const manifests = walk(path.join(root, "additional")).filter((f) =>
  f.endsWith(path.sep + "standalone.json"),
);
if (!manifests.length) throw new Error("No standalone.json manifests found");
let failed = false;
for (const manifest of manifests) {
  const { dir, id, outputs } = build(manifest);
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(dir, name);
    if (args.has("--check")) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
        console.error(`STALE ${path.relative(root, file)} (run node tools/build-standalone.cjs)`);
        failed = true;
      }
    } else {
      const temp = file + ".building";
      fs.writeFileSync(temp, content);
      fs.renameSync(temp, file);
    }
  }
  if (!args.has("--check")) console.log(`Built standalone ${id} -> ${path.relative(root, dir)}`);
}
if (failed) process.exit(1);
if (args.has("--check")) console.log("Standalone packages are up to date");
