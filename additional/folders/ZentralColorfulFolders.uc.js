/*
 * Zentral Colorful Folders
 *
 * Owns the colour of ordinary Zen sidebar folders. It never creates, deletes,
 * moves, renames, reorders or reparents tabs/folders. A folder is painted only
 * by writing its colour custom properties and the private marker below.
 *
 * Notes owns its projected Notes folders. Those carry one of the
 * bgalazka-notes-* ownership attributes; we clear only our own prior paint
 * and leave the folder to Notes. This attribute contract is independent of
 * script load order, so Notes and this module cannot race over one folder.
 *
 * Stored records contain only a salted SHA-256 hash of a folder id, not the
 * folder id or its label. We deliberately do not store a label hash: even a
 * salted name hash can be guessed offline if a profile's prefs are exposed.
 * The random salt is profile-local; preference data is bounded and validated.
 */
(function () {
  "use strict";

  // <<FOLDER-STYLE-CORE v3
  // One implementation of "which colors does a folder get". The same text sits in ZentralColorfulFolders.uc.js and
  // ZentralNotes.uc.js (tests/colorful-folders.test.cjs compares the two copies), so the Zen sidebar, the All notes tree and a
  // Notes-only install can never disagree. Pure: no DOM, no preferences, no timers.
  //   record  = { b: primary "#rrggbb", d: per-layer colors, o: per-layer opacity 0..100 }
  //   Simple mode: only `b` (primary) and `d.stroke` (secondary = outline) are read; every other layer is derived from them.
  //   Detailed mode: `d` layers override the derived ones.
  //   Precedence for one folder: its own record > the default of its level (1 = root, up to 5) > the all-levels default.
  //   A folder that has its own colors never inherits default colors or default opacity (a default can not overwrite it).
  const FOLDER_STYLE = (() => {
    const PARTS = Object.freeze(["back", "front", "stroke", "label", "accent", "tint", "hover"]);
    const MAX_DEPTH = 5;
    const HEX = /^#[0-9a-fA-F]{6}$/;
    const hex = (v) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : "");
    const detail = (raw) => {
      const out = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw))
        for (const p of PARTS) {
          const h = hex(raw[p]);
          if (h) out[p] = h;
        }
      return out;
    };
    const opacity = (raw) => {
      const out = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw))
        for (const p of PARTS) {
          const n = Number(raw[p]);
          if (raw[p] !== undefined && raw[p] !== null && Number.isInteger(n) && n >= 0 && n <= 100) out[p] = n;
        }
      return out;
    };
    const norm = (raw) => {
      const r = raw && typeof raw === "object" ? raw : {};
      return { b: hex(r.b ?? r.color), d: detail(r.d ?? r.parts), o: opacity(r.o ?? r.opacity) };
    };
    const hasColor = (r) => !!r && (!!r.b || Object.keys(r.d).length > 0);
    const lum = (h) => {
      const n = parseInt(h.slice(1), 16);
      const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const textOn = (h) => (lum(h) > 0.4 ? "#1b1b1f" : "#ffffff");
    const contrast = (a, b) => {
      const x = hex(a), y = hex(b);
      if (!x || !y) return 21;
      const l1 = lum(x), l2 = lum(y);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const mix = (c, pct, other) => `color-mix(in srgb, ${c} ${pct}%, ${other})`;
    function derive(base, secondary) {
      const color = hex(base);
      if (!color) return {};
      const edge = hex(secondary);
      return {
        back: `light-dark(${mix(color, 60, "gray")}, ${mix(color, 60, "#c1c1c1")})`,
        front: `light-dark(color-mix(in srgb, ${color}, white 70%), color-mix(in srgb, ${color}, black 40%))`,
        stroke: edge || `light-dark(${mix(color, 50, "black")}, ${mix(color, 15, "#ebebeb")})`,
        label: `light-dark(${mix(color, 55, "black")}, ${mix(color, 55, "white")})`,
        accent: color,
        tint: mix(color, 16, "transparent"),
        hover: mix(color, 30, "transparent"),
      };
    }
    function partsFor(rec, mode) {
      const r = norm(rec);
      const out = r.b ? derive(r.b, r.d.stroke) : {};
      if (!r.b || mode === "detailed")
        for (const p of PARTS) if (r.d[p]) out[p] = p === "tint" ? mix(r.d.tint, 22, "transparent") : r.d[p];
      return out;
    }
    function declarations(parts, op) {
      const out = {};
      const alpha = opacity(op);
      const fade = (value, p) => (alpha[p] === undefined || alpha[p] >= 100 ? value : mix(value, alpha[p], "transparent"));
      for (const p of PARTS) {
        if (!parts || !parts[p]) continue;
        const value = fade(parts[p], p);
        if (p === "back") out["--zen-folder-behind-bgcolor"] = value;
        else if (p === "front") out["--zen-folder-front-bgcolor"] = value;
        else if (p === "stroke") out["--zen-folder-stroke"] = value;
        else if (p === "label") out["--bgalazka-fc-label"] = value;
        else if (p === "accent") {
          const on = parts.accentText || "#ffffff";
          const off = on === "#ffffff" ? "#1b1b1f" : "#ffffff";
          out["--tab-group-color"] = value;
          out["--tab-group-background-color"] = value;
          out["--tab-group-color-invert"] = off;
          out["--tab-group-text-color"] = on;
          out["--tab-group-text-color-invert"] = off;
          out["--bgalazka-fc-accent"] = value;
        } else if (p === "tint") {
          out["--tab-group-color-pale"] = value;
          out["--bgalazka-fc-tint"] = value;
        } else if (p === "hover") {
          out["--tab-group-background-color-hover"] = value;
          out["--bgalazka-fc-hover"] = value;
        }
      }
      return out;
    }
    // Every custom property a painter may set; a painter removes the ones a style does not produce.
    const OWNED = Object.freeze([
      "--zen-folder-behind-bgcolor", "--zen-folder-front-bgcolor", "--zen-folder-stroke", "--bgalazka-fc-label",
      "--tab-group-color", "--tab-group-background-color", "--tab-group-color-invert", "--tab-group-text-color",
      "--tab-group-text-color-invert", "--tab-group-color-pale", "--tab-group-background-color-hover",
      "--bgalazka-fc-accent", "--bgalazka-fc-tint", "--bgalazka-fc-hover",
    ]);
    const clampDepth = (depth) => Math.max(1, Math.min(MAX_DEPTH, Math.floor(Number(depth)) || 1));
    function parseLayers(raw) {
      try {
        const text = String(raw || "");
        if (!text || text.length > 32768) return {};
        const parsed = JSON.parse(text);
        const src = parsed && typeof parsed === "object" ? parsed.l || parsed : {};
        const out = {};
        for (let n = 1; n <= MAX_DEPTH; n++) {
          const r = norm(src[n]);
          if (hasColor(r) || Object.keys(r.o).length) out[n] = r;
        }
        return out;
      } catch (_) {
        return {};
      }
    }
    function serializeLayers(layers) {
      const l = {};
      for (let n = 1; n <= MAX_DEPTH; n++) {
        const r = norm(layers && layers[n]);
        if (hasColor(r) || Object.keys(r.o).length) l[n] = r;
      }
      return JSON.stringify({ v: 1, l });
    }
    // Level of a folder element = number of zen-folder elements from it up to the root (1 = top level).
    function elementDepth(el) {
      let n = 0;
      for (let c = el; c && n < 64; c = c.parentElement || c.parentNode || c.parent) if (c.localName === "zen-folder" || c.tag === "zen-folder") n++;
      return clampDepth(n);
    }
    // env = { mode, defaults: record, layers: { 1..5: record }, ignoreLabel }
    function resolve(raw, depth, env) {
      const e = env && typeof env === "object" ? env : {};
      const mode = e.mode === "detailed" ? "detailed" : "simple";
      const own = norm(raw);
      const level = clampDepth(depth);
      let source, from;
      if (hasColor(own)) {
        source = own;
        from = "folder";
      } else {
        const layer = norm(e.layers && (e.layers[level] ?? e.layers[String(level)]));
        const global = norm(e.defaults);
        const pick = hasColor(layer) ? layer : global;
        from = hasColor(layer) ? "level" : hasColor(global) ? "default" : "none";
        source = { b: pick.b, d: pick.d, o: { ...pick.o, ...own.o } };
      }
      const parts = partsFor(source, mode);
      if (e.ignoreLabel) delete parts.label;
      const accent = hex(parts.accent) || source.b;
      if (accent) parts.accentText = textOn(accent);
      return { base: source.b, parts, opacity: source.o, properties: declarations(parts, source.o), from, depth: level, mode };
    }
    // Collections: ordered groups of looks. Applying a collection to the defaults gives level 1 the first look, level 2 the
    // second, and so on (cycling), so a root folder, a subfolder and a sub-subfolder stay recognisable but different.
    // A look keeps to `b`, `d.stroke` (secondary) and `o` wherever it can, so it also works in Simple mode.
    const COLLECTIONS = Object.freeze([
      { group: "Classic yellow folders", items: [
        { n: "Kraft paper", b: "#c8a165", d: { back: "#a98147", front: "#e6c993", stroke: "#5c4120" }, o: {} },
        { n: "Honey", b: "#f2a900", d: { back: "#d48a00", front: "#ffd26a", stroke: "#6b4300" }, o: {} },
        { n: "Manila", b: "#e8b923", d: { back: "#c99a1c", front: "#f6d567", stroke: "#7a5a05" }, o: {} },
        { n: "Butter", b: "#f0cf4a", d: { back: "#d1b232", front: "#fbe88a", stroke: "#75600b" }, o: {} },
        { n: "Lemon", b: "#f4e04d", d: { back: "#d6c12f", front: "#fff59a", stroke: "#6f6410" }, o: {} },
      ] },
      { group: "Dark glass", items: [
        { n: "Slate glass", b: "#3b4452", d: { stroke: "#8fa3bd" }, o: { back: 55, front: 40 } },
        { n: "Ink glass", b: "#1f2a44", d: { stroke: "#7f95c9" }, o: { back: 55, front: 38 } },
        { n: "Moss glass", b: "#23392f", d: { stroke: "#7fb69a" }, o: { back: 55, front: 40 } },
        { n: "Wine glass", b: "#3b2230", d: { stroke: "#c487a6" }, o: { back: 55, front: 40 } },
        { n: "Ember glass", b: "#3a2a1f", d: { stroke: "#d9a066" }, o: { back: 55, front: 40 } },
      ] },
      { group: "Sticky notes", items: [
        { n: "Canary", b: "#ffe066", d: { back: "#e9c93a", front: "#fff1a8", stroke: "#8a6d00" }, o: {} },
        { n: "Pink slip", b: "#ff8fb3", d: { back: "#ec6f98", front: "#ffc2d6", stroke: "#8c2149" }, o: {} },
        { n: "Mint note", b: "#7be0b5", d: { back: "#52c796", front: "#b9f3da", stroke: "#0f6a47" }, o: {} },
        { n: "Sky memo", b: "#7cc4ff", d: { back: "#52a8ec", front: "#c1e3ff", stroke: "#124d82" }, o: {} },
        { n: "Peach", b: "#ffb27a", d: { back: "#ef9558", front: "#ffd6b8", stroke: "#8a4310" }, o: {} },
      ] },
      { group: "Neon outline", items: [
        { n: "Cyan line", b: "#12202b", d: { stroke: "#2fd8ec" }, o: { back: 70, front: 55 } },
        { n: "Magenta line", b: "#26122b", d: { stroke: "#e45be0" }, o: { back: 70, front: 55 } },
        { n: "Lime line", b: "#1b2612", d: { stroke: "#a6dd3c" }, o: { back: 70, front: 55 } },
        { n: "Orange line", b: "#2b1d10", d: { stroke: "#f0922a" }, o: { back: 70, front: 55 } },
        { n: "Violet line", b: "#1c1530", d: { stroke: "#9b83f2" }, o: { back: 70, front: 55 } },
      ] },
      { group: "Dark folders", items: [
        { n: "Graphite", b: "#343a40", d: {}, o: {} },
        { n: "Midnight", b: "#202b3b", d: {}, o: {} },
        { n: "Deep forest", b: "#234236", d: {}, o: {} },
        { n: "Plum shadow", b: "#493047", d: {}, o: {} },
      ] },
      { group: "High contrast", items: [
        { n: "Amber", b: "#d97706", d: { front: "#ffe0a3", stroke: "#3b2100" }, o: {} },
        { n: "Aqua", b: "#087e8b", d: { front: "#b9f4f4", stroke: "#032f36" }, o: {} },
        { n: "Rose", b: "#be3455", d: { front: "#ffd2df", stroke: "#3d0716" }, o: {} },
        { n: "Electric blue", b: "#2557d6", d: { front: "#d8e5ff", stroke: "#071b50" }, o: {} },
      ] },
      { group: "Colorful", items: [
        { n: "Coral", b: "#ff8066", d: {}, o: {} },
        { n: "Mint", b: "#40b99a", d: {}, o: {} },
        { n: "Lavender", b: "#9c83e6", d: {}, o: {} },
        { n: "Sunflower", b: "#e5bd38", d: {}, o: {} },
      ] },
    ]);
    // A look needs Detailed mode only when it sets a layer other than the secondary (outline) color.
    const needsDetailed = (look) => Object.keys(detail(look && look.d)).some((p) => p !== "stroke");
    // Collection -> { 1: look, 2: look, ... } for the five default levels.
    function spreadCollection(group) {
      const items = (group && Array.isArray(group.items) ? group.items : []).map(norm).filter(hasColor);
      const out = {};
      if (!items.length) return out;
      for (let n = 1; n <= MAX_DEPTH; n++) out[n] = items[(n - 1) % items.length];
      return out;
    }
    return Object.freeze({ PARTS, MAX_DEPTH, OWNED, COLLECTIONS, hex, detail, opacity, norm, hasColor, lum, textOn, contrast, derive, partsFor, declarations, clampDepth, parseLayers, serializeLayers, elementDepth, resolve, needsDetailed, spreadCollection });
  })();
  // FOLDER-STYLE-CORE>>

  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
  const PREFIX = "zen.workspace.zentral.folder_colors.";
  const P = Object.freeze({
    ENABLED: PREFIX + "enabled",
    MENU: PREFIX + "menu",
    MODE: PREFIX + "mode",
    BASE: PREFIX + "default_base",
    DATA: PREFIX + "data",
    SALT: PREFIX + "salt",
    THEMES: PREFIX + "themes",
    OPACITY_SCHEMA: PREFIX + "opacity_schema",
    LAYERS: PREFIX + "default_layers",
    IGNORE_LABEL: PREFIX + "ignore_label",
    STYLE_ICON: PREFIX + "style_icon",
    STYLE_ACCENT: PREFIX + "style_accent",
    STYLE_TINT_HEADER: PREFIX + "style_tint_header",
    STYLE_TINT_TABS: PREFIX + "style_tint_tabs",
    STYLE_HOVER: PREFIX + "style_hover",
    LINE_CLICK: PREFIX + "line_click",
    LINE_HOVER: PREFIX + "line_hover",
  });
  // Zen's own custom properties that belong to one switchable part of the styling (see styleToggles()).
  const TOGGLE_PROPERTIES = Object.freeze({
    icon: ["--zen-folder-behind-bgcolor", "--zen-folder-front-bgcolor", "--zen-folder-stroke"],
    accent: ["--tab-group-color", "--tab-group-background-color", "--tab-group-color-invert", "--tab-group-text-color", "--tab-group-text-color-invert", "--bgalazka-fc-accent"],
    tint: ["--tab-group-color-pale"],
    hover: ["--tab-group-background-color-hover"],
  });
  const ROOT_FLAGS = Object.freeze({
    "bgalazka-fc-no-accent": "accent",
    "bgalazka-fc-no-tint-header": "tintHeader",
    "bgalazka-fc-no-tint-tabs": "tintTabs",
    "bgalazka-fc-no-hover": "hover",
    "bgalazka-fc-line-click": "lineClick",
    "bgalazka-fc-line-hover": "lineHover",
  });
  const PARTS = FOLDER_STYLE.PARTS;
  const PART_LABELS = Object.freeze({
    back: "Icon: back",
    front: "Icon: front",
    stroke: "Icon: outline and glyph",
    label: "Folder label",
    accent: "Folder and tab selection accent",
    tint: "Soft background tint",
    hover: "Hover background",
  });
  const PART_PREFS = Object.freeze(
    Object.fromEntries(PARTS.map((part) => [part, PREFIX + "default_" + part])),
  );
  const OPACITY_PREFS = Object.freeze(
    Object.fromEntries(PARTS.map((part) => [part, PREFIX + "default_" + part + "_opacity"])),
  );
  const MARK = "bgalazka-folder-colors";
  const LAYERS_ATTR = "bgalazka-fc-layers";
  const LINE_HOT_ATTR = "bgalazka-fc-line-hot";
  let hoveredLineFolder = null;
  const MENU_MARK = "bgalazka-fc-menu";
  const MAX_RECORDS = 400;
  const MAX_THEMES = 24;
  const MAX_DATA_LENGTH = 1024 * 1024;
  const XHTML = "http://www.w3.org/1999/xhtml";

  // These preferences used to be applied by ZentralAppearance. The one-time
  // migration copies existing user values to the new visible schema and clears
  // their retired keys; they remain as a read-only fallback if migration fails.
  const LEGACY_DEFAULTS = Object.freeze({
    back: "zen.workspace.bgalazka.look.folder_behind",
    backOpacity: "zen.workspace.bgalazka.look.folder_behind_opacity",
    front: "zen.workspace.bgalazka.look.folder_front",
    frontOpacity: "zen.workspace.bgalazka.look.folder_front_opacity",
    stroke: "zen.workspace.bgalazka.look.folder_stroke",
    strokeOpacity: "zen.workspace.bgalazka.look.folder_stroke_opacity",
    label: "zen.workspace.bgalazka.look.folder_label",
  });

  // ---------------------------------------------- pure, testable colour/data core
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  const HASH_RE = /^[0-9a-f]{64}$/;
  const cleanHex = FOLDER_STYLE.hex;
  const cleanHash = (value) =>
    typeof value === "string" && HASH_RE.test(value) ? value : "";
  const cleanDetail = FOLDER_STYLE.detail;
  const cleanOpacity = FOLDER_STYLE.opacity;
  const hasColor = (record) =>
    !!record &&
    (!!cleanHex(record.b) || PARTS.some((part) => cleanHex(record.d?.[part])) || Object.keys(cleanOpacity(record.o)).length > 0);
  function cleanRecord(raw) {
    if (!raw || typeof raw !== "object") return null;
    const record = {
      i: cleanHash(raw.i),
      b: cleanHex(raw.b),
      d: cleanDetail(raw.d),
      o: cleanOpacity(raw.o),
      u: Number.isFinite(raw.u) ? Math.max(0, Math.floor(raw.u)) : 0,
    };
    if (!record.i || !hasColor(record)) return null;
    return record;
  }
  function parseData(raw) {
    try {
      const text = String(raw || "");
      if (text.length > MAX_DATA_LENGTH) return [];
      const parsed = JSON.parse(text);
      if (!parsed || ![1, 2].includes(parsed.v) || !Array.isArray(parsed.r)) return [];
      return parsed.r.map(cleanRecord).filter(Boolean).slice(0, MAX_RECORDS);
    } catch (_) {
      return [];
    }
  }
  function serializeData(records) {
    const clean = (Array.isArray(records) ? records : [])
      .map(cleanRecord)
      .filter(Boolean)
      .sort((a, b) => b.u - a.u)
      .slice(0, MAX_RECORDS);
    return JSON.stringify({ v: 2, r: clean });
  }
  function cleanTheme(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = String(raw.n || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 36);
    const b = cleanHex(raw.b);
    const d = cleanDetail(raw.d);
    if (!name || (!b && !Object.keys(d).length)) return null;
    const o = cleanOpacity(raw.o);
    return { n: name, b, d, o };
  }
  function parseThemes(raw) {
    try {
      const text = String(raw || "");
      if (text.length > 65536) return [];
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      const seen = new Set();
      const out = [];
      for (const item of parsed) {
        const theme = cleanTheme(item);
        if (!theme || seen.has(theme.n.toLocaleLowerCase())) continue;
        seen.add(theme.n.toLocaleLowerCase());
        out.push(theme);
        if (out.length >= MAX_THEMES) break;
      }
      return out;
    } catch (_) {
      return [];
    }
  }
  const derive = FOLDER_STYLE.derive;
  const partsFor = FOLDER_STYLE.partsFor;
  const declarations = FOLDER_STYLE.declarations;
  const textOn = FOLDER_STYLE.textOn;
  const mix = (hex, percent, other) => `color-mix(in srgb, ${hex} ${percent}%, ${other})`;

  // Small synchronous SHA-256. The browser's Web Crypto is asynchronous; this
  // keeps lookup and save operations synchronous in both Gecko and Node tests.
  const K256 = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  function sha256Hex(text) {
    const bytes = new TextEncoder().encode(String(text));
    const length = bytes.length;
    const total = Math.ceil((length + 9) / 64) * 64;
    const buffer = new Uint8Array(total);
    buffer.set(bytes);
    buffer[length] = 0x80;
    const view = new DataView(buffer.buffer);
    const bits = length * 8;
    view.setUint32(total - 8, Math.floor(bits / 0x100000000));
    view.setUint32(total - 4, bits >>> 0);
    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    const words = new Uint32Array(64);
    const rotr = (value, count) =>
      (value >>> count) | (value << (32 - count));
    for (let offset = 0; offset < total; offset += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = words[i - 15];
        const b = words[i - 2];
        const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
        const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
        words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let i = 0; i < 64; i++) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const choice = (e & f) ^ (~e & g);
        const t1 = (h + s1 + choice + K256[i] + words[i]) >>> 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (s0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map((n) => n.toString(16).padStart(8, "0")).join("");
  }
  const hashKey = (salt, kind, value) =>
    value ? sha256Hex(salt + "\u0000" + kind + "\u0000" + value) : "";

  const BUILTIN_THEMES = FOLDER_STYLE.COLLECTIONS;

  // Place a floating editor beside its anchor without covering that folder.
  // If horizontal space is tight, it uses the larger vertical gap; only on an
  // exceptionally tiny viewport does it fall back to the least-overlapping corner.
  function placePanel(anchor, requestedWidth, requestedHeight, viewportWidth, viewportHeight) {
    const margin = 8, gap = 12;
    const width = Math.max(1, Math.min(requestedWidth, viewportWidth - margin * 2));
    const height = Math.max(1, Math.min(requestedHeight, viewportHeight - margin * 2));
    if (!anchor) return { left: margin, top: margin, width, height, overlaps: false };
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const candidates = [];
    const add = (left, top, w, h, rank) => {
      if (w < 160 || h < 100) return;
      const r = { left, top, right: left + w, bottom: top + h };
      const overlapW = Math.max(0, Math.min(r.right, anchor.right) - Math.max(r.left, anchor.left));
      const overlapH = Math.max(0, Math.min(r.bottom, anchor.bottom) - Math.max(r.top, anchor.top));
      candidates.push({ left, top, width: w, height: h, area: w * h, overlap: overlapW * overlapH, rank });
    };
    const maxH = viewportHeight - margin * 2;
    const rightW = viewportWidth - anchor.right - gap - margin;
    const leftW = anchor.left - gap - margin;
    if (rightW >= 160) add(anchor.right + gap, clamp(anchor.top, margin, viewportHeight - margin - height), Math.min(width, rightW), height, 0);
    if (leftW >= 160) add(anchor.left - gap - Math.min(width, leftW), clamp(anchor.top, margin, viewportHeight - margin - height), Math.min(width, leftW), height, 1);
    const belowH = viewportHeight - anchor.bottom - gap - margin;
    const aboveH = anchor.top - gap - margin;
    if (belowH >= 100) add(clamp(anchor.left, margin, viewportWidth - margin - width), anchor.bottom + gap, width, Math.min(height, belowH), 2);
    if (aboveH >= 100) add(clamp(anchor.left, margin, viewportWidth - margin - width), anchor.top - gap - Math.min(height, aboveH), width, Math.min(height, aboveH), 3);
    const clear = candidates.filter((c) => c.overlap === 0);
    const pool = clear.length ? clear : candidates;
    if (pool.length) {
      pool.sort((a, b) => b.area - a.area || a.rank - b.rank);
      const best = pool[0];
      return { left: best.left, top: best.top, width: best.width, height: best.height, overlaps: best.overlap > 0 };
    }
    const corners = [
      [margin, margin],
      [viewportWidth - margin - width, margin],
      [margin, viewportHeight - margin - height],
      [viewportWidth - margin - width, viewportHeight - margin - height],
    ].map(([left, top], rank) => {
      const overlapW = Math.max(0, Math.min(left + width, anchor.right) - Math.max(left, anchor.left));
      const overlapH = Math.max(0, Math.min(top + height, anchor.bottom) - Math.max(top, anchor.top));
      return { left, top, width, height, overlap: overlapW * overlapH, rank };
    }).sort((a, b) => a.overlap - b.overlap || a.rank - b.rank);
    const best = corners[0];
    return { left: best.left, top: best.top, width, height, overlaps: best.overlap > 0 };
  }

  // ---------------------------------------------- privileged-window integration
  function start({ lifecycle, runtime }) {
    if (!lifecycle || typeof lifecycle.own !== "function")
      throw new Error("Colorful folders requires the Zentral lifecycle scope");

    const pref = Services.prefs;
    const getString = (name, fallback = "") => {
      try { return pref.getStringPref(name, fallback); } catch (_) { return fallback; }
    };
    const getBool = (name, fallback = false) => {
      try { return pref.getBoolPref(name, fallback); } catch (_) { return fallback; }
    };
    const getInt = (name, fallback = 100) => {
      try { return pref.getIntPref(name, fallback); } catch (_) { return fallback; }
    };
    const setBool = (name, value) => {
      try { pref.setBoolPref(name, !!value); return true; } catch (_) { return false; }
    };
    const setString = (name, value) => {
      try { pref.setStringPref(name, String(value)); return true; } catch (_) { return false; }
    };
    // -1 is the explicit "inherit" sentinel; 0..100 are real opacity values.
    const setInt = (name, value) => {
      try {
        const number = Number(value);
        if (!Number.isInteger(number) || number < -1 || number > 100) return false;
        pref.setIntPref(name, number);
        return true;
      } catch (_) { return false; }
    };
    const enabled = () => getBool(P.ENABLED, true);
    const menuEnabled = () => getBool(P.MENU, true);
    const mode = () => getString(P.MODE, "simple") === "detailed" ? "detailed" : "simple";
    // Each part of the styling can be switched off on its own; every switch defaults to on.
    function styleToggles() {
      return {
        icon: getBool(P.STYLE_ICON, true),
        accent: getBool(P.STYLE_ACCENT, true),
        tintHeader: getBool(P.STYLE_TINT_HEADER, true),
        tintTabs: getBool(P.STYLE_TINT_TABS, true),
        hover: getBool(P.STYLE_HOVER, true),
        lineClick: getBool(P.LINE_CLICK, true),
        lineHover: getBool(P.LINE_HOVER, true),
      };
    }
    // Drops the properties of every part that is switched off. Used for Zen folders, the NOTES folders (through the shared
    // style bridge) and the All notes tree, so one switch changes all of them.
    function filterProperties(properties) {
      const toggles = styleToggles();
      const off = [];
      if (!toggles.icon) off.push(...TOGGLE_PROPERTIES.icon);
      if (!toggles.accent) off.push(...TOGGLE_PROPERTIES.accent);
      if (!toggles.tintHeader && !toggles.tintTabs) off.push(...TOGGLE_PROPERTIES.tint);
      if (!toggles.hover) off.push(...TOGGLE_PROPERTIES.hover);
      if (!off.length) return properties;
      const out = { ...properties };
      for (const property of off) delete out[property];
      return out;
    }
    function syncRootFlags() {
      const toggles = styleToggles();
      const root = document.documentElement;
      if (!root) return;
      for (const [attr, key] of Object.entries(ROOT_FLAGS)) {
        const positive = key.startsWith("line");
        // Style switches are stored as "no-..." flags so an untouched profile has no extra attributes; line switches are positive.
        const wanted = positive ? !!toggles[key] : !toggles[key];
        if (wanted) { if (root.getAttribute?.(attr) !== "true") root.setAttribute(attr, "true"); }
        else if (root.hasAttribute?.(attr)) root.removeAttribute(attr);
      }
    }

    const previousFolderColorPresets = window.__zentralFolderColorPresets;
    const publishedFolderColorPresets = BUILTIN_THEMES.map((group) => ({
      group: group.group,
      items: group.items.map((theme) => ({ n: theme.n, b: theme.b, d: { ...theme.d }, o: { ...theme.o } })),
    }));
    window.__zentralFolderColorPresets = publishedFolderColorPresets;
    window.dispatchEvent?.(new Event("zentral-folder-color-presets-ready"));
    lifecycle.own(() => {
      if (window.__zentralFolderColorPresets !== publishedFolderColorPresets) return;
      if (previousFolderColorPresets) window.__zentralFolderColorPresets = previousFolderColorPresets;
      else delete window.__zentralFolderColorPresets;
      window.dispatchEvent?.(new Event("zentral-folder-color-presets-gone"));
    });
    // Migration 2 transfers the former Appearance folder colors into this
    // module's visible controls. The old keys are cleared only after their
    // value has been copied, so the retired painter cannot silently reclaim
    // ownership after a Reset. Version 1 also reserved -1 for inherit and made
    // a true 0% transparency selectable.
    const previousOpacitySchema = getInt(P.OPACITY_SCHEMA, 0);
    if (previousOpacitySchema < 2) {
      let migratedLegacyDetails = false;
      const legacyColors = [
        ["back", LEGACY_DEFAULTS.back],
        ["front", LEGACY_DEFAULTS.front],
        ["stroke", LEGACY_DEFAULTS.stroke],
        ["label", LEGACY_DEFAULTS.label],
      ];
      for (const [part, legacyKey] of legacyColors) {
        const current = cleanHex(getString(PART_PREFS[part], ""));
        const legacy = cleanHex(getString(legacyKey, ""));
        if (!current && legacy && setString(PART_PREFS[part], legacy))
          migratedLegacyDetails = true;
      }
      if (previousOpacitySchema < 1) {
        for (const part of PARTS) {
          const current = getInt(OPACITY_PREFS[part], -1);
          if (current === 0) {
            // Before schema 1, zero was the inherit placeholder and was not selectable.
            setInt(OPACITY_PREFS[part], -1);
          }
        }
      }
      for (const [part, legacyKey] of [
        ["back", LEGACY_DEFAULTS.backOpacity],
        ["front", LEGACY_DEFAULTS.frontOpacity],
        ["stroke", LEGACY_DEFAULTS.strokeOpacity],
      ]) {
        if (getInt(OPACITY_PREFS[part], -1) !== -1) continue;
        const legacy = getInt(legacyKey, 100);
        if (legacy >= 0 && legacy < 100 && setInt(OPACITY_PREFS[part], legacy))
          migratedLegacyDetails = true;
      }
      if (migratedLegacyDetails) setString(P.MODE, "detailed");
      for (const key of Object.values(LEGACY_DEFAULTS)) {
        try { if (pref.prefHasUserValue(key)) pref.clearUserPref(key); } catch (_) {}
      }
      try { pref.setIntPref(P.OPACITY_SCHEMA, 2); } catch (_) {}
    }
    // Materialize the shared mode preference so Notes never guesses a
    // different default while both owners initialize in either order.
    try {
      if (!pref.prefHasUserValue(P.MODE)) pref.setStringPref(P.MODE, "simple");
    } catch (_) {}
    const state = {
      salt: getString(P.SALT, ""),
      dataRaw: getString(P.DATA, ""),
      data: parseData(getString(P.DATA, "")),
      themesRaw: getString(P.THEMES, ""),
      themes: parseThemes(getString(P.THEMES, "")),
      layersRaw: getString(P.LAYERS, ""),
    };
    // Canonicalize any prototype v1 records on startup. This strips the old
    // label-hash field from stored preferences while preserving ID/color data.
    if (state.data.length) {
      const canonical = serializeData(state.data);
      if (canonical !== state.dataRaw && setString(P.DATA, canonical))
        state.dataRaw = canonical;
    }
    const painted = new Set();
    const owned = new WeakMap();
    let paintTimer = null;
    let observer = null;
    let settingsUnregister = null;
    let editor = null;
    let editorHost = null;
    let editorAbort = null;

    function randomSalt() {
      try {
        const bytes = new Uint8Array(24);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
      } catch (_) {
        return "";
      }
    }
    function ensureSalt() {
      if (/^[0-9a-f]{48}$/.test(state.salt)) return state.salt;
      // If a profile has records but its salt was manually removed, do not
      // silently re-key them. Keep the records inert rather than misapply them.
      if (state.data.length) return "";
      const next = randomSalt();
      if (!next || !setString(P.SALT, next)) return "";
      state.salt = next;
      return next;
    }
    function folderIdentity(folder) {
      const id = String(folder?.getAttribute?.("id") || folder?.id || "").trim();
      const salt = ensureSalt();
      if (!salt || !id) return { i: "" };
      return { i: hashKey(salt, "id", id) };
    }
    function liveFolders() {
      const root =
        document.getElementById("tabbrowser-tabs") ||
        window.gBrowser?.tabContainer ||
        document.querySelector?.("#tabbrowser-tabs");
      if (!root) return [];
      const out = [];
      if (root.localName === "zen-folder") out.push(root);
      out.push(...(root.querySelectorAll?.("zen-folder") || []));
      return [...new Set(out)];
    }
    function isNotesOwned(folder) {
      const id = String(folder?.getAttribute?.("id") || folder?.id || "");
      const marked = [
        "bgalazka-notes-color",
        "bgalazka-notes-folder",
        "bgalazka-notes-subfolder",
      ].some((attr) => folder?.hasAttribute?.(attr));
      if (marked) return true;
      // Zen keeps native folder ids when Notes releases a folder containing a
      // person's own tabs. Once Notes is unloaded those folders become normal
      // folders again; ID alone must not make Colorful Folders skip them forever.
      return !!notesBridge() && (
        id === "bgalazka-zentral-notes" ||
        id.startsWith("bgalazka-zentral-notes-sub_")
      );
    }
    function notesBridge() {
      const bridge = window.__zentralNotesFolderColorBridge;
      return bridge && bridge.version === 1 &&
        typeof bridge.read === "function" && typeof bridge.write === "function"
        ? bridge
        : null;
    }
    function waitForNotesBridge(timeout = 2500) {
      const ready = notesBridge();
      if (ready) return Promise.resolve(ready);
      return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          if (timer !== null) lifecycle.clearTimeout(timer);
          window.removeEventListener("zentral-notes-folder-color-bridge-ready", onReady);
          resolve(value);
        };
        const onReady = () => finish(notesBridge());
        window.addEventListener("zentral-notes-folder-color-bridge-ready", onReady, { once: true });
        const started = Date.now();
        const poll = () => {
          const bridge = notesBridge();
          if (bridge) return finish(bridge);
          if (!lifecycle.active || Date.now() - started >= timeout) return finish(null);
          timer = lifecycle.setTimeout(poll, 100);
        };
        timer = lifecycle.setTimeout(poll, 100);
      });
    }
    function readNotesFolderFallback(folder) {
      const folderId = String(folder?.getAttribute?.("id") || folder?.id || "");
      const isRoot = folder?.hasAttribute?.("bgalazka-notes-folder") || folderId === "bgalazka-zentral-notes";
      const readString = (key) => { try { return pref.getStringPref(key, ""); } catch (_) { return ""; } };
      const readObject = (key) => {
        try {
          const value = JSON.parse(readString(key) || "{}");
          return value && typeof value === "object" && !Array.isArray(value) ? value : {};
        } catch (_) { return {}; }
      };
      const colorHex = (value) => {
        const named = {
          yellow: "#f5c542", green: "#4cc38a", blue: "#5aa9ff", pink: "#ff7eb6",
          purple: "#a78bfa", orange: "#ff9f43", red: "#ff6b6b", teal: "#2ec4b6", gray: "#9aa0a6",
        };
        return cleanHex(value) || named[String(value || "").toLowerCase()] || "";
      };
      if (isRoot) return {
        b: colorHex(readString("zen.workspace.zentral.notes.zen_root_color")),
        d: cleanDetail(readObject("zen.workspace.zentral.notes.zen_root_parts")),
        o: cleanOpacity(readObject("zen.workspace.zentral.notes.zen_root_part_opacity")),
      };
      return {
        b: colorHex(folder?.getAttribute?.("bgalazka-notes-color") || ""),
        d: cleanDetail(readObjectFromAttribute(folder, "bgalazka-notes-parts")),
        o: cleanOpacity(readObjectFromAttribute(folder, "bgalazka-notes-parts-opacity")),
      };
    }
    function readObjectFromAttribute(folder, name) {
      try {
        const value = JSON.parse(folder?.getAttribute?.(name) || "{}");
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      } catch (_) { return {}; }
    }
    function uniqueRecordFor(folder) {
      const identity = folderIdentity(folder);
      return identity.i
        ? state.data.find((record) => record.i === identity.i) || null
        : null;
    }
    function readFolderRecord(folder) {
      return uniqueRecordFor(folder) || null;
    }
    function writeData() {
      const next = serializeData(state.data);
      if (next.length > MAX_DATA_LENGTH || !setString(P.DATA, next)) return false;
      state.dataRaw = next;
      state.data = parseData(next);
      return true;
    }
    function setFolderRecord(folder, raw) {
      const identity = folderIdentity(folder);
      if (!identity.i) return false;
      const matched = uniqueRecordFor(folder);
      const next = cleanRecord({
        i: identity.i || matched?.i || "",
        b: raw ? cleanHex(raw.b) : "",
        d: raw ? cleanDetail(raw.d) : {},
        o: raw ? cleanOpacity(raw.o) : {},
        u: Date.now(),
      });
      const remove = new Set();
      if (identity.i) state.data.forEach((r, index) => { if (r.i === identity.i) remove.add(index); });
      if (matched) {
        const at = state.data.indexOf(matched);
        if (at >= 0) remove.add(at);
      }
      state.data = state.data.filter((_r, index) => !remove.has(index));
      if (next) state.data.unshift(next);
      const ok = writeData();
      schedulePaint();
      return ok;
    }
    // The all-levels default. The retired Appearance keys (zen.workspace.bgalazka.look.folder_*) only fill layers the
    // new keys leave empty and only while no base color is set; the one-time migration clears them.
    function defaultRecord() {
      const detail = {};
      const opacity = {};
      for (const part of PARTS) {
        const value = cleanHex(getString(PART_PREFS[part], ""));
        if (value) detail[part] = value;
        const alpha = getInt(OPACITY_PREFS[part], -1);
        if (alpha >= 0 && alpha <= 100) opacity[part] = alpha;
      }
      const base = cleanHex(getString(P.BASE, ""));
      if (!base) {
        for (const [part, key, opacityKey] of [
          ["back", LEGACY_DEFAULTS.back, LEGACY_DEFAULTS.backOpacity],
          ["front", LEGACY_DEFAULTS.front, LEGACY_DEFAULTS.frontOpacity],
          ["stroke", LEGACY_DEFAULTS.stroke, LEGACY_DEFAULTS.strokeOpacity],
          ["label", LEGACY_DEFAULTS.label, ""],
        ]) {
          const color = cleanHex(getString(key, ""));
          if (color && !detail[part]) detail[part] = color;
          if (opacityKey && opacity[part] === undefined) {
            const legacy = getInt(opacityKey, 100);
            if (legacy >= 0 && legacy < 100) opacity[part] = legacy;
          }
        }
      }
      return { b: base, d: detail, o: opacity };
    }
    // Level defaults: { 1: record, ... 5: record }. Level 1 is a top-level folder (the NOTES root is level 1).
    function layerRecords() {
      return FOLDER_STYLE.parseLayers(state.layersRaw);
    }
    function styleEnv() {
      return {
        mode: mode(),
        defaults: defaultRecord(),
        layers: layerRecords(),
        ignoreLabel: getBool(P.IGNORE_LABEL, false),
      };
    }
    function opacityColor(value, opacity) {
      const color = cleanHex(value);
      if (!color) return "";
      const pct = Math.max(0, Math.min(100, Math.round(Number(opacity))));
      return pct >= 100 ? color : mix(color, pct, "transparent");
    }
    function resolveStyle(rawRecord = null, depth = 1) {
      const resolved = FOLDER_STYLE.resolve(rawRecord, depth, styleEnv());
      return { ...resolved, properties: filterProperties(resolved.properties) };
    }
    function folderDepth(folder) {
      return FOLDER_STYLE.elementDepth(folder);
    }
    function styleMapFor(folder) {
      if (isNotesOwned(folder)) return {};
      return resolveStyle(readFolderRecord(folder), folderDepth(folder)).properties;
    }
    const previousStyleBridge = window.__zentralFolderColorStyleBridge;
    const folderColorStyleBridge = Object.freeze({
      version: 1,
      revision: 3,
      resolve: (record, depth) => resolveStyle(record, depth),
      defaults: (depth) => resolveStyle(null, depth),
      collections: () => FOLDER_STYLE.COLLECTIONS,
    });
    window.__zentralFolderColorStyleBridge = folderColorStyleBridge;
    window.dispatchEvent?.(new Event("zentral-folder-color-style-bridge-ready"));
    lifecycle.own(() => {
      if (window.__zentralFolderColorStyleBridge === folderColorStyleBridge) {
        if (previousStyleBridge) window.__zentralFolderColorStyleBridge = previousStyleBridge;
        else delete window.__zentralFolderColorStyleBridge;
        window.dispatchEvent?.(new Event("zentral-folder-color-style-bridge-gone"));
      }
    });

    function rememberAndSet(folder, property, value) {
      let map = owned.get(folder);
      if (!map) {
        map = new Map();
        owned.set(folder, map);
      }
      const previous = map.get(property) || {
        value: folder.style.getPropertyValue(property),
        priority: folder.style.getPropertyPriority?.(property) || "",
        ours: "",
        oursPriority: "important",
      };
      if (value) {
        folder.style.setProperty(property, value, "important");
        previous.ours = value;
        map.set(property, previous);
      } else if (map.has(property)) {
        const current = folder.style.getPropertyValue(property);
        const currentPriority = folder.style.getPropertyPriority?.(property) || "";
        if (current === previous.ours && currentPriority === previous.oursPriority) {
          if (previous.value) folder.style.setProperty(property, previous.value, previous.priority);
          else folder.style.removeProperty(property);
        }
        map.delete(property);
      }
      if (!map.size) owned.delete(folder);
    }
    function clearFolderPaint(folder) {
      const map = owned.get(folder);
      if (map) for (const property of [...map.keys()]) rememberAndSet(folder, property, "");
      if (folder.hasAttribute?.(MARK)) folder.removeAttribute(MARK);
      if (folder.hasAttribute?.(LAYERS_ATTR)) folder.removeAttribute(LAYERS_ATTR);
      if (folder.hasAttribute?.(LINE_HOT_ATTR)) folder.removeAttribute(LINE_HOT_ATTR);
      if (hoveredLineFolder === folder) hoveredLineFolder = null;
      painted.delete(folder);
    }
    function paintFolder(folder) {
      if (!folder || folder.localName !== "zen-folder") return;
      if (isNotesOwned(folder)) {
        // Notes is the source of truth for its projected folders. Always ask
        // its bridge to reapply the current values after removing any stale
        // paint from this module; this also handles Notes starting after us.
        clearFolderPaint(folder);
        try { notesBridge()?.refresh?.(folder); } catch (error) {
          console.warn("[Zentral Colorful Folders] Notes hand-off failed:", error);
        }
        return;
      }
      if (!enabled()) {
        clearFolderPaint(folder);
        return;
      }
      const values = styleMapFor(folder);
      const map = owned.get(folder) || new Map();
      const previousKeys = [...map.keys()];
      for (const property of previousKeys)
        if (!Object.prototype.hasOwnProperty.call(values, property))
          rememberAndSet(folder, property, "");
      for (const [property, value] of Object.entries(values))
        rememberAndSet(folder, property, value);
      if (Object.keys(values).length) {
        folder.setAttribute(MARK, "true");
        // Which extra layers have a value; the stylesheet below only draws a layer that is listed here, so a folder
        // without a color keeps Zen's own look.
        const layers = [
          ["--bgalazka-fc-accent", "accent"],
          ["--bgalazka-fc-tint", "tint"],
          ["--bgalazka-fc-hover", "hover"],
        ].filter(([property]) => values[property]).map(([, name]) => name).join(" ");
        if (!values["--bgalazka-fc-accent"]) {
          folder.removeAttribute(LINE_HOT_ATTR);
          if (hoveredLineFolder === folder) hoveredLineFolder = null;
        }
        if (layers) folder.setAttribute(LAYERS_ATTR, layers);
        else folder.removeAttribute(LAYERS_ATTR);
        painted.add(folder);
      } else {
        folder.removeAttribute(MARK);
        folder.removeAttribute(LAYERS_ATTR);
        painted.delete(folder);
      }
    }
    function paintAll() {
      paintTimer = null;
      syncRootFlags();
      const folders = liveFolders();
      for (const folder of folders) paintFolder(folder);
      for (const folder of [...painted])
        if (!folder.isConnected || !folders.includes(folder)) clearFolderPaint(folder);
    }
    function schedulePaint() {
      if (paintTimer !== null || !lifecycle.active) return;
      paintTimer = lifecycle.setTimeout(() => {
        paintTimer = null;
        paintAll();
      }, 0);
    }


    // ---------------------------------------------- native folder accent-line interactions
    // Keep Zen's own line geometry. The two existing visual pieces are the 2px inset
    // accent on .tab-group-container and Zen's .tab-group-line; we only add hover and
    // click behavior to those exact hit areas. No SVGs, child-row measuring or DOM edits.
    const LINE_HIT_WIDTH = 8;
    const isZenFolder = (node) => node?.localName === "zen-folder" || node?.tagName === "ZEN-FOLDER" || node?.tag === "zen-folder";
    const hasClass = (node, name) => !!node?.classList?.contains(name);
    const lineContainer = (folder) =>
      folder?.groupContainer || [...(folder?.children || [])].find((child) => hasClass(child, "tab-group-container")) || null;
    function eventPath(event) {
      try {
        const path = event.composedPath?.();
        if (Array.isArray(path) && path.length) return path;
      } catch (_) {}
      const path = [];
      for (let node = event.target; node; node = node.parentNode || node.parentElement) path.push(node);
      return path;
    }
    function isAccentFolder(folder) {
      if (!folder || !isZenFolder(folder) || folder.localName === "zen-workspace-collapsible-pins") return false;
      if (!enabled() || !styleToggles().accent) return false;
      return String(folder.getAttribute?.(LAYERS_ATTR) || "").split(/\s+/).includes("accent");
    }
    function isInsetAccentHit(container, event) {
      if (!container || !container.getBoundingClientRect || !Number.isFinite(Number(event.clientX))) return false;
      const rect = container.getBoundingClientRect();
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) return false;
      let rtl = false;
      try { rtl = (window.getComputedStyle?.(container)?.direction || document.defaultView?.getComputedStyle?.(container)?.direction) === "rtl"; } catch (_) {}
      const distance = rtl ? rect.right - Number(event.clientX) : Number(event.clientX) - rect.left;
      // The visible stripe is 2px. A small 8px hit zone makes it easy to use without
      // swallowing clicks on the tab labels or the rest of the folder contents.
      return distance >= -1 && distance <= LINE_HIT_WIDTH;
    }
    function accentHitFolder(event) {
      const path = eventPath(event);
      const onNativeLine = path.some((node) => hasClass(node, "tab-group-line"));
      for (const node of path) {
        if (!isZenFolder(node) || !isAccentFolder(node)) continue;
        const container = lineContainer(node);
        if (!container) continue;
        if ((onNativeLine && path.includes(container)) || (path.includes(container) && isInsetAccentHit(container, event)))
          return node;
      }
      return null;
    }
    function setLineHover(folder) {
      if (hoveredLineFolder === folder) return;
      if (hoveredLineFolder?.hasAttribute?.(LINE_HOT_ATTR)) hoveredLineFolder.removeAttribute(LINE_HOT_ATTR);
      hoveredLineFolder = folder || null;
      if (hoveredLineFolder) hoveredLineFolder.setAttribute(LINE_HOT_ATTR, "true");
    }
    function updateLineHover(event) {
      if (!styleToggles().lineHover || !enabled()) { setLineHover(null); return; }
      setLineHover(accentHitFolder(event));
    }
    function clearLineHover() { setLineHover(null); }
    function onAccentLineClick(event) {
      if (event.button !== 0 || !styleToggles().lineClick || !enabled()) return;
      const folder = accentHitFolder(event);
      if (!folder) return;
      // Use Zen's native collapsed setter. Do not repaint, remeasure or rebuild anything
      // after toggling: the browser owns the folder's child layout and collapse animation.
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      folder.collapsed = !folder.collapsed;
      clearLineHover();
    }
    lifecycle.own(() => {
      clearLineHover();
      try { for (const folder of liveFolders()) folder.removeAttribute?.(LINE_HOT_ATTR); } catch (_) {}
      try { for (const attr of Object.keys(ROOT_FLAGS)) document.documentElement.removeAttribute(attr); } catch (_) {}
    });

    function createElement(tag, attrs = {}, ...children) {
      const element = document.createElementNS(XHTML, tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") element.className = value;
        else if (key === "text") element.textContent = String(value);
        else if (value === true) element.setAttribute(key, "");
        else if (value !== false && value != null) element.setAttribute(key, String(value));
      }
      for (const child of children.flat())
        if (child != null)
          element.append(child?.nodeType ? child : document.createTextNode(String(child)));
      return element;
    }
    const css = `
      :root zen-folder[${MARK}] > .tab-group-label-container > label {
        color: var(--bgalazka-fc-label) !important;
      }
      /* Zen draws folders from its own variables and hides the group line, so the accent, soft tint and hover layers need
         rules of their own. A layer is drawn only when the folder lists it, so an unstyled folder is left to Zen. */
      /* Each part can be switched off from settings; the switches are flags on the root element. */
      :root:not([bgalazka-fc-no-tint-header]) zen-folder[${LAYERS_ATTR}~="tint"] > .tab-group-label-container {
        background-color: var(--bgalazka-fc-tint) !important;
        border-radius: 8px;
      }
      :root:not([bgalazka-fc-no-tint-tabs]) zen-folder[${LAYERS_ATTR}~="tint"] > .tab-group-container {
        background-color: var(--bgalazka-fc-tint) !important;
        border-radius: 8px;
      }
      :root:not([bgalazka-fc-no-hover]) zen-folder[${LAYERS_ATTR}~="hover"] > .tab-group-label-container:hover {
        background-color: var(--bgalazka-fc-hover) !important;
      }
      /* Reuse Zen's existing accent geometry: a 2px inset spine plus its native group-line segment.
         The only interaction is a small hit-test around that exact line; no synthetic tree is drawn. */
      :root:not([bgalazka-fc-no-accent]) zen-folder[${LAYERS_ATTR}~="accent"] > .tab-group-container {
        box-shadow: inset 2px 0 0 0 var(--bgalazka-fc-accent) !important;
        transition: box-shadow .12s ease;
      }
      :root:not([bgalazka-fc-no-accent]) zen-folder[${LAYERS_ATTR}~="accent"] .tab-group-line {
        background-color: var(--bgalazka-fc-accent) !important;
      }
      :root[bgalazka-fc-line-click] zen-folder[${LAYERS_ATTR}~="accent"] .tab-group-line { cursor: pointer !important; }
      /* The base accent shadow is !important, so the hot-state shadow must be too.
         Make the change obvious: the 2px spine widens to 4px and gets a soft inner
         glow. This is still the same native container/line, not a second connector. */
      :root[bgalazka-fc-line-hover] zen-folder[${LAYERS_ATTR}~="accent"][${LINE_HOT_ATTR}] > .tab-group-container {
        box-shadow: inset 4px 0 0 0 var(--bgalazka-fc-accent),
          inset 8px 0 8px -5px var(--bgalazka-fc-accent) !important;
        cursor: pointer !important;
      }
      :root[bgalazka-fc-line-hover] zen-folder[${LINE_HOT_ATTR}] .tab-group-line {
        filter: brightness(1.55) saturate(1.35) drop-shadow(0 0 2px var(--bgalazka-fc-accent)) !important;
      }
      .zcf-panel { position: relative; z-index: 2147483647; width: 760px; max-width: calc(100vw - 20px);
        max-height: min(82vh, 680px); overflow: auto; box-sizing: border-box; padding: 12px; border-radius: 12px;
        background: Canvas; color: CanvasText; color-scheme: light dark; font: menu; pointer-events: auto;
        border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); box-shadow: 0 8px 28px rgba(0,0,0,.35); }
      .zcf-header { display:flex; align-items:center; gap:8px; margin:0 0 8px; cursor:grab; user-select:none; touch-action:none; }
      .zcf-header:active { cursor:grabbing; }
      .zcf-header h3 { flex:1; min-width:0; margin:0; font-size:14px; }
      .zcf-close { border:1px solid color-mix(in srgb, CanvasText 25%, transparent); border-radius:7px; padding:2px 7px; background:transparent; color:inherit; cursor:pointer; }
      .zcf-panel h4 { margin: 10px 0 4px; font-size: 11px; opacity: .7; text-transform: uppercase; }
      .zcf-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
      .zcf-row > span { flex: 1; min-width: 0; font-size: 12px; }
      .zcf-row input[type=color] { width: 36px; height: 26px; padding: 0; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); border-radius: 6px; background: transparent; }
      .zcf-row input[type=text] { width: 82px; min-width: 0; }
      .zcf-opacity { display:flex; align-items:center; gap:8px; flex:1 1 280px; min-width:240px; }
      .zcf-opacity > span { flex:0 0 auto; }
      .zcf-opacity input { flex:1 1 auto; width:auto; min-width:120px; }
      .zcf-row input[type=range] { flex:1 1 160px; min-width:120px; }
      .zcf-tree-box { border-top:1px solid color-mix(in srgb, CanvasText 15%, transparent); margin-top:8px; padding-top:6px; }
      .zcf-tree-box select { min-width:0; flex:1; }
      .zcf-opacity output { width:34px; text-align:right; font:11px monospace; }
      .zcf-showcase { display:grid; grid-template-columns:repeat(auto-fit,minmax(104px,1fr)); gap:7px; margin:8px 0 12px; }
      .zcf-showcase button { display:flex; flex-direction:column; align-items:center; gap:5px; min-height:58px; padding:8px 6px; border:1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius:9px; background:color-mix(in srgb, Canvas 94%, CanvasText 6%); color:inherit; cursor:pointer; }
      .zcf-showcase-icon { width:40px; height:25px; display:block; border:1px solid color-mix(in srgb, CanvasText 40%, transparent); border-radius:6px 6px 4px 4px; background:linear-gradient(135deg,var(--zcf-back) 0 50%,var(--zcf-front) 50% 100%); box-shadow:inset 0 -3px 0 var(--zcf-stroke); }
      .zcf-showcase small { font-size:11px; }
      .zcf-status { min-height:1.4em; font-size:11px; color:color-mix(in srgb, CanvasText 70%, transparent); }
      .zcf-row button, .zcf-btns button { border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); border-radius: 7px; padding: 4px 8px; background: color-mix(in srgb, Canvas 90%, CanvasText 10%); color: inherit; }
      .zcf-swatches { display: flex; flex-wrap: wrap; gap: 5px; margin: 7px 0; }
      .zcf-swatch { min-width: 0; border: 1px solid color-mix(in srgb, CanvasText 30%, transparent); border-radius: 6px; padding: 5px 7px; color: CanvasText; font-size: 11px; }
      .zcf-list-row { display: grid; grid-template-columns: 18px minmax(0,1fr) auto auto; gap: 7px; align-items: center; padding: 5px 0; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
      .zcf-default-color { width:32px; height:24px; padding:0; border:1px solid color-mix(in srgb, CanvasText 25%, transparent); border-radius:6px; background:transparent; }
      .zcf-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      .zcf-preview { width: 15px; height: 15px; border-radius: 4px; border: 1px solid color-mix(in srgb, CanvasText 28%, transparent); }
      .zcf-muted { font-size: 11px; opacity: .7; }
      .zcf-btns { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-top: 10px; }
      .zcf-detail { border-top: 1px solid color-mix(in srgb, CanvasText 15%, transparent); margin-top: 8px; padding-top: 7px; }
      .zcf-detail summary { cursor: pointer; font-size: 12px; }
      .zcf-modes { gap: 0; }
      .zcf-modes button { flex: 1; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); padding: 4px 8px; background: transparent; color: inherit; }
      .zcf-modes button:first-child { border-radius: 7px 0 0 7px; }
      .zcf-modes button:last-child { border-radius: 0 7px 7px 0; border-inline-start: 0; }
      .zcf-modes button[aria-selected=true] { background: color-mix(in srgb, Highlight 35%, Canvas); font-weight: 600; }
      .zcf-check { display: flex; align-items: flex-start; gap: 7px; margin: 8px 0; font-size: 12px; cursor: pointer; }
      .zcf-contrast:empty { display: none; }
      .zcf-tabs { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0; }
      .zcf-tabs button { border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); border-radius: 7px; padding: 3px 8px; background: transparent; color: inherit; font-size: 11px; }
      .zcf-tabs button[aria-pressed=true] { background: color-mix(in srgb, Highlight 35%, Canvas); }
    `;
    const style = createElement("style", { id: "zentral-colorful-folders-style" });
    style.textContent = css;
    lifecycle.own(() => style.remove());
    document.documentElement.appendChild(style);

    const previewBackground = (record) => {
      const parts = resolveStyle(record || null).parts;
      const back = parts.back || parts.accent || "#707780";
      const front = parts.front || parts.accent || "#a0a8b0";
      return `linear-gradient(135deg, ${back} 50%, ${front} 50%)`;
    };
    const LEVEL_NAMES = [
      "All folders (default look)",
      "Level 1 · top-level folders",
      "Level 2 · subfolders",
      "Level 3 · second subfolders",
      "Level 4 · third subfolders",
      "Level 5 · fourth subfolders and deeper",
    ];
    function announceDefaultsChanged() {
      schedulePaint();
      // Notes redraws its All notes tree when told that the shared style changed.
      try { window.dispatchEvent?.(new Event("zentral-folder-color-defaults-changed")); } catch (_) {}
    }
    function writeAllLevelsDefault(record) {
      const next = record ? { b: cleanHex(record.b), d: cleanDetail(record.d), o: cleanOpacity(record.o) } : null;
      if (!setString(P.BASE, next?.b || "")) return false;
      for (const part of PARTS) {
        if (!setString(PART_PREFS[part], next?.d?.[part] || "")) return false;
        if (!setInt(OPACITY_PREFS[part], next?.o?.[part] ?? -1)) return false;
      }
      announceDefaultsChanged();
      return true;
    }
    function writeLevelDefault(level, record) {
      const layers = layerRecords();
      const next = record ? FOLDER_STYLE.norm(record) : null;
      if (next && (FOLDER_STYLE.hasColor(next) || Object.keys(next.o).length)) layers[level] = next;
      else delete layers[level];
      const raw = FOLDER_STYLE.serializeLayers(layers);
      if (!setString(P.LAYERS, raw)) return false;
      state.layersRaw = raw;
      announceDefaultsChanged();
      return true;
    }
    // level 0 = every level that has no default of its own; 1..5 = that nesting level only.
    function defaultTarget(level = 0) {
      return {
        title: LEVEL_NAMES[level] || LEVEL_NAMES[0],
        depth: Math.max(1, level),
        level,
        read: () => (level ? layerRecords()[level] || { b: "", d: {}, o: {} } : defaultRecord()),
        write: (record) => (level ? writeLevelDefault(level, record) : writeAllLevelsDefault(record)),
      };
    }
    // A collection gives level 1 its first look, level 2 its second, and so on.
    function applyCollectionToLevels(group) {
      const spread = FOLDER_STYLE.spreadCollection(group);
      if (!Object.keys(spread).length) return false;
      const raw = FOLDER_STYLE.serializeLayers(spread);
      if (!setString(P.LAYERS, raw)) return false;
      state.layersRaw = raw;
      if (Object.values(spread).some((look) => FOLDER_STYLE.needsDetailed(look))) setString(P.MODE, "detailed");
      announceDefaultsChanged();
      return true;
    }
    // One look for every default folder: the all-levels default is replaced and the level defaults are cleared.
    function applyLookEverywhere(look) {
      if (FOLDER_STYLE.needsDetailed(look)) setString(P.MODE, "detailed");
      const ok = writeAllLevelsDefault(look);
      if (ok) {
        setString(P.LAYERS, FOLDER_STYLE.serializeLayers({}));
        state.layersRaw = FOLDER_STYLE.serializeLayers({});
        announceDefaultsChanged();
      }
      return ok;
    }
    function folderTarget(folder) {
      const title = String(folder.getAttribute("label") || folder.label || "Folder");
      if (isNotesOwned(folder)) {
        return {
          title,
          folder,
          notesOwned: true,
          available: true,
          prepare: async () => {
            const isRoot = String(folder.id || folder.getAttribute?.("id") || "") === "bgalazka-zentral-notes" || folder.hasAttribute?.("bgalazka-notes-folder");
            let bridge = notesBridge();
            // The root is preference-backed and remains editable before Notes
            // has published its bridge. A subfolder, however, must load Notes'
            // metadata store before its style can safely be edited.
            if (!bridge && !isRoot) bridge = await waitForNotesBridge();
            if (bridge?.prepare) await bridge.prepare();
            return !!bridge || isRoot;
          },
          read: () => {
            try { return notesBridge()?.read(folder) || readNotesFolderFallback(folder); }
            catch (error) {
              console.warn("[Zentral Colorful Folders] could not read Notes folder style:", error);
              return readNotesFolderFallback(folder);
            }
          },
          write: async (record) => {
            const next = record ? { b: cleanHex(record.b), d: cleanDetail(record.d), o: cleanOpacity(record.o) } : null;
            let bridge = notesBridge();
            if (!bridge && (folder.hasAttribute?.("bgalazka-notes-folder") || String(folder.id || "") === "bgalazka-zentral-notes")) {
              // NOTES root appearance is preference-backed, so it can be edited
              // even before the Notes UI has published its richer bridge.
              try {
                pref.setStringPref("zen.workspace.zentral.notes.zen_root_color", next?.b || "");
                pref.setStringPref("zen.workspace.zentral.notes.zen_root_parts", JSON.stringify(next?.d || {}));
                pref.setStringPref("zen.workspace.zentral.notes.zen_root_part_opacity", JSON.stringify(next?.o || {}));
                const value = next ? { b: next.b, d: next.d, o: next.o } : { b: "", d: {}, o: {} };
                const colors = resolveStyle(value, 1).properties;
                for (const property of FOLDER_STYLE.OWNED) {
                  if (colors[property]) folder.style.setProperty(property, colors[property], "important");
                  else folder.style.removeProperty(property);
                }
                return true;
              } catch (error) {
                console.warn("[Zentral Colorful Folders] NOTES root save failed:", error);
                return false;
              }
            }
            if (!bridge) bridge = await waitForNotesBridge();
            if (!bridge) return false;
            return bridge.write(folder, next);
          },
        };
      }
      return {
        title,
        folder,
        available: true,
        depth: folderDepth(folder),
        read: () => readFolderRecord(folder),
        write: (record) => setFolderRecord(folder, record),
      };
    }


    // ---------------------------------------------- one look for a whole folder tree
    function subfolderList(folder) {
      const out = [];
      try {
        for (const inner of folder.querySelectorAll?.("zen-folder") || [])
          if (inner !== folder && inner.localName === "zen-folder") out.push(inner);
      } catch (_) {}
      return out;
    }
    // 0 for the folder the person clicked, 1 for its subfolders, 2 for theirs, and so on.
    function relativeDepth(root, folder) {
      let depth = 0;
      for (let node = folder; node && node !== root; node = node.parentElement?.closest?.("zen-folder")) depth++;
      return depth;
    }
    // Writes one look per folder, one after the other (Notes folders go through a shared store that must not be raced).
    async function applyToTree(root, pick, { includeRoot = true } = {}) {
      const folders = [...(includeRoot ? [root] : []), ...subfolderList(root)];
      let done = 0, failed = 0, detailed = false;
      for (const folder of folders) {
        const look = pick(relativeDepth(root, folder), folder);
        if (!look) continue;
        if (FOLDER_STYLE.needsDetailed(look)) detailed = true;
        const target = folderTarget(folder);
        try {
          if (typeof target.prepare === "function") await target.prepare();
          const ok = await target.write({ b: look.b || "", d: look.d || {}, o: look.o || {} });
          if (ok === false) failed++; else done++;
        } catch (error) {
          failed++;
          console.warn("[Zentral Colorful Folders] tree apply failed for", target.title, error);
        }
      }
      if (detailed) setString(P.MODE, "detailed");
      schedulePaint();
      return { done, failed, total: folders.length };
    }
    const treeResultText = (result) =>
      !result.total ? "No subfolders to change."
        : `Applied to ${result.done} folder${result.done === 1 ? "" : "s"}` + (result.failed ? `, ${result.failed} could not be saved.` : ".");
    // A collection gives the clicked folder its first look, its subfolders the second, their subfolders the third (cycling).
    function collectionPicker(group) {
      const items = (group && Array.isArray(group.items) ? group.items : []).map(FOLDER_STYLE.norm).filter(FOLDER_STYLE.hasColor);
      return items.length ? (depth) => items[depth % items.length] : null;
    }

    function openTargetEditor(target, anchor) {
      if (typeof target.prepare !== "function") return openEditor(target, anchor);
      Promise.resolve(target.prepare()).then((ready) => {
        target.available = !!ready;
        openEditor(target, anchor);
        if (!ready && editor) {
          const status = editor.querySelector?.(".zcf-status");
          if (status) status.textContent = "Notes storage is not ready yet. Open Notes once, then Apply.";
        }
      }).catch((error) => {
        console.warn("[Zentral Colorful Folders] Notes folder preparation failed:", error);
        openEditor(target, anchor);
      });
    }
    function closeEditor() {
      if (editorAbort) { editorAbort(); editorAbort = null; }
      try { editorHost?.hidePopup?.(); } catch (_) {}
      editorHost?.remove?.();
      editorHost = null;
      editor?.remove();
      editor = null;
    }
    function saveTheme(raw) {
      const theme = cleanTheme(raw);
      if (!theme) return false;
      const key = theme.n.toLocaleLowerCase();
      state.themes = [theme, ...state.themes.filter((item) => item.n.toLocaleLowerCase() !== key)].slice(0, MAX_THEMES);
      const next = JSON.stringify(state.themes);
      if (!setString(P.THEMES, next)) return false;
      state.themesRaw = next;
      schedulePaint();
      return true;
    }
    // Quick colors are shared with the Notes color pickers (one preference, up to 8 "#rrggbb", newest first).
    const QUICK_PREF = "zen.workspace.zentral.notes.custom_colors";
    const quickColors = () => {
      const out = [];
      for (const part of getString(QUICK_PREF, "").split(/[\s,;]+/)) {
        const hex = cleanHex(part);
        if (hex && !out.includes(hex)) out.push(hex);
        if (out.length >= 8) break;
      }
      return out;
    };
    const saveQuickColor = (hex) => {
      const clean = cleanHex(hex);
      if (clean) setString(QUICK_PREF, [clean, ...quickColors().filter((c) => c !== clean)].slice(0, 8).join(","));
    };
    // Mode rule (the Notes editor follows the same): in Simple, choosing a primary color or a look drops every Detailed
    // layer except the secondary (outline) color, so Simple overrides Detailed. In Detailed, a layer left on Auto keeps
    // following the primary color, and the picked layers fine tune it.
    function openEditor(target, anchor) {
      closeEditor();
      const element = createElement("div", { class: "zcf-panel", role: "dialog", "aria-label": "Folder colors" });
      editor = element;
      const depthOfTarget = Number.isInteger(target.depth) ? target.depth : 1;
      let record = target.read() || { b: "", d: {}, o: {} };
      record = { b: cleanHex(record.b), d: cleanDetail(record.d), o: cleanOpacity(record.o) };
      let editMode = mode();
      const header = createElement("div", { class: "zcf-header" });
      const heading = createElement("h3", { text: `Colors · ${target.title}` });
      const close = createElement("button", { type: "button", class: "zcf-close", text: "×", "aria-label": "Close color editor" });
      header.append(heading, close);
      close.addEventListener("click", closeEditor);
      element.appendChild(header);
      const intro = createElement("div", { class: "zcf-muted", text: "Pick a primary color (the folder) and a secondary color (its outline). The folder accent line uses that same primary color; Detailed lets you set its exact color with the Accent layer. Nothing is saved until you press Apply." });
      element.appendChild(intro);

      // ---- mode switch
      const modeRow = createElement("div", { class: "zcf-row zcf-modes", role: "tablist" });
      const simpleTab = createElement("button", { type: "button", role: "tab", text: "Simple" });
      const detailTab = createElement("button", { type: "button", role: "tab", text: "Detailed" });
      modeRow.append(simpleTab, detailTab);
      element.appendChild(modeRow);

      // ---- simple section: primary + secondary
      const simpleBox = createElement("div", { class: "zcf-simple" });
      const colorRow = (label, aria) => {
        const row = createElement("div", { class: "zcf-row" });
        const color = createElement("input", { type: "color", "aria-label": aria });
        const hex = createElement("input", { type: "text", maxlength: "7", spellcheck: "false", placeholder: "auto", "aria-label": aria + " as hex" });
        const auto = createElement("button", { type: "button", text: "Auto" });
        row.append(createElement("span", { text: label }), color, hex, auto);
        return { row, color, hex, auto };
      };
      const primary = colorRow("Primary (folder)", "Primary color");
      const secondary = colorRow("Secondary (outline)", "Secondary outline color");
      const contrastNote = createElement("div", { class: "zcf-muted zcf-contrast", role: "status" });
      const quickRow = createElement("div", { class: "zcf-swatches" });
      // One transparency slider for the two big layers of the folder icon (Simple); Detailed has one per layer.
      const bodyRow = createElement("div", { class: "zcf-row" });
      const bodyAlpha = createElement("input", { type: "range", min: "0", max: "100", step: "1", "aria-label": "Folder transparency" });
      const bodyAlphaValue = createElement("output", { text: "Auto" });
      bodyAlpha.addEventListener("input", () => {
        const value = Number(bodyAlpha.value);
        if (value >= 100) { delete record.o.back; delete record.o.front; }
        else { record.o.back = value; record.o.front = value; }
        bodyAlphaValue.textContent = value >= 100 ? "Auto" : value + "%";
      });
      bodyRow.append(createElement("span", { text: "Folder opacity (0% = transparent)" }), bodyAlpha, bodyAlphaValue);
      simpleBox.append(primary.row, secondary.row, contrastNote, bodyRow, createElement("h4", { text: "My quick colors" }), quickRow);
      element.appendChild(simpleBox);

      // ---- detailed section: all seven layers
      const detailBox = createElement("div", { class: "zcf-detailbox" });
      const partInputs = new Map();
      const fallbackColor = () => record.b || cleanHex(defaultRecord().b) || "#667788";
      for (const part of PARTS) {
        const row = createElement("div", { class: "zcf-row" });
        row.style.flexWrap = "wrap";
        const color = createElement("input", { type: "color", "aria-label": PART_LABELS[part] });
        const hex = createElement("input", { type: "text", maxlength: "7", spellcheck: "false", placeholder: "auto", "aria-label": PART_LABELS[part] + " as hex" });
        const opacityBox = createElement("span", { class: "zcf-opacity" });
        const opacity = createElement("input", { type: "range", min: "0", max: "100", step: "1", "aria-label": PART_LABELS[part] + " opacity" });
        const opacityValue = createElement("output", { text: "Auto" });
        opacityBox.append(createElement("span", { text: "Opacity" }), opacity, opacityValue);
        const auto = createElement("button", { type: "button", text: "Auto" });
        color.addEventListener("input", () => setPart(part, color.value));
        hex.addEventListener("input", () => {
          const raw = hex.value.trim();
          const value = cleanHex(raw.startsWith("#") ? raw : "#" + raw);
          if (value) setPart(part, value);
        });
        opacity.addEventListener("input", () => {
          record.o[part] = Number(opacity.value);
          opacityValue.textContent = opacity.value + "%";
        });
        auto.addEventListener("click", () => {
          delete record.d[part];
          delete record.o[part];
          syncInputs();
        });
        row.append(createElement("span", { text: PART_LABELS[part] }), color, hex, opacityBox, auto);
        detailBox.appendChild(row);
        partInputs.set(part, { color, hex, opacity, opacityValue });
      }
      element.appendChild(detailBox);

      // ---- collections and quick themes (same palette as the Notes editor)
      const palette = createElement("div", { class: "zcf-palette" });
      const presetButtons = [];
      const addPreset = (host, look, title) => {
        const button = createElement("button", { type: "button", class: "zcf-swatch", text: look.n, title });
        button.style.background = previewBackground(look);
        button.addEventListener("click", () => {
          record = { b: cleanHex(look.b), d: cleanDetail(look.d), o: cleanOpacity(look.o) };
          if (FOLDER_STYLE.needsDetailed(look)) setEditMode("detailed");
          else if (editMode === "simple") record.d = { ...(record.d.stroke ? { stroke: record.d.stroke } : {}) };
          syncInputs();
        });
        presetButtons.push(button);
        host.appendChild(button);
      };
      for (const group of BUILTIN_THEMES) {
        palette.appendChild(createElement("h4", { text: group.group }));
        const swatches = createElement("div", { class: "zcf-swatches" });
        for (const look of group.items) addPreset(swatches, look, group.group + " · " + look.n);
        palette.appendChild(swatches);
      }
      if (state.themes.length) {
        palette.appendChild(createElement("h4", { text: "My quick themes" }));
        const swatches = createElement("div", { class: "zcf-swatches" });
        for (const theme of state.themes) addPreset(swatches, theme, "Saved theme · " + theme.n);
        palette.appendChild(swatches);
      }
      const paletteBox = createElement("details", { class: "zcf-detail" });
      paletteBox.append(createElement("summary", { text: "Collections and quick themes" }), palette);
      paletteBox.open = true;
      element.appendChild(paletteBox);

      // ---- label color opt-out
      const labelRow = createElement("label", { class: "zcf-check" });
      const labelBox = createElement("input", { type: "checkbox", "aria-label": "Ignore my folder label color" });
      labelBox.checked = getBool(P.IGNORE_LABEL, false);
      labelBox.addEventListener("change", () => setBool(P.IGNORE_LABEL, labelBox.checked));
      labelRow.append(labelBox, createElement("span", { text: "Ignore my folder label color (let the Zen theme decide, keeps names readable when a theme changes)" }));
      element.appendChild(labelRow);

      // ---- saved themes
      const themeRow = createElement("div", { class: "zcf-row" });
      const themeName = createElement("input", { type: "text", maxlength: "36", placeholder: "Theme name", "aria-label": "Theme name" });
      const saveThemeButton = createElement("button", { type: "button", text: "Save as quick theme" });
      saveThemeButton.addEventListener("click", () => {
        const name = themeName.value.trim();
        if (!saveTheme({ n: name, b: record.b, d: record.d, o: record.o })) {
          themeName.focus?.();
          themeName.setAttribute("aria-invalid", "true");
        } else {
          themeName.value = "";
          themeName.removeAttribute("aria-invalid");
        }
      });
      themeRow.append(themeName, saveThemeButton);
      element.appendChild(themeRow);

      const status = createElement("div", { class: "zcf-status", role: "status" });
      element.appendChild(status);

      // ---- state helpers
      function setPart(part, value) {
        const clean = cleanHex(value);
        if (!clean) return;
        record.d[part] = clean;
        if (part === "stroke" && editMode === "simple") syncInputs();
        else syncInputs(part);
      }
      function setPrimary(value) {
        const clean = cleanHex(value);
        if (!clean) return;
        record.b = clean;
        if (editMode === "simple") record.d = record.d.stroke ? { stroke: record.d.stroke } : {};
        syncInputs();
      }
      function syncInputs(skipPart) {
        const shown = record.b || cleanHex(defaultRecord().b) || "#667788";
        primary.color.value = shown;
        primary.hex.value = record.b || "";
        const edge = record.d.stroke || "";
        secondary.color.value = edge || shown;
        secondary.hex.value = edge;
        const ratio = record.b && edge ? FOLDER_STYLE.contrast(record.b, edge) : 21;
        bodyAlpha.value = String(record.o.back === undefined ? 100 : record.o.back);
        bodyAlphaValue.textContent = record.o.back === undefined ? "Auto" : record.o.back + "%";
        bodyRow.hidden = editMode !== "simple";
        contrastNote.textContent = ratio < 1.6 ? "Outline and folder colors are very close; the outline will be hard to see." : "";
        for (const [part, input] of partInputs) {
          if (part === skipPart) continue;
          input.hex.value = record.d[part] || "";
          input.color.value = record.d[part] || (FOLDER_STYLE.hex(fallbackColor()) || "#667788");
          input.opacity.value = String(record.o[part] === undefined ? 100 : record.o[part]);
          input.opacityValue.textContent = record.o[part] === undefined ? "Auto" : record.o[part] + "%";
        }
        for (const button of presetButtons) button.dataset.active = "false";
      }
      function setEditMode(next) {
        editMode = next;
        simpleTab.setAttribute("aria-selected", String(next === "simple"));
        detailTab.setAttribute("aria-selected", String(next === "detailed"));
        detailBox.hidden = next !== "detailed";
        syncInputs();
      }
      simpleTab.addEventListener("click", () => setEditMode("simple"));
      detailTab.addEventListener("click", () => setEditMode("detailed"));
      primary.color.addEventListener("input", () => setPrimary(primary.color.value));
      primary.hex.addEventListener("input", () => {
        const raw = primary.hex.value.trim();
        const value = cleanHex(raw.startsWith("#") ? raw : "#" + raw);
        if (value) setPrimary(value);
      });
      primary.auto.addEventListener("click", () => { record.b = ""; syncInputs(); });
      secondary.color.addEventListener("input", () => setPart("stroke", secondary.color.value));
      secondary.hex.addEventListener("input", () => {
        const raw = secondary.hex.value.trim();
        const value = cleanHex(raw.startsWith("#") ? raw : "#" + raw);
        if (value) setPart("stroke", value);
      });
      secondary.auto.addEventListener("click", () => { delete record.d.stroke; syncInputs(); });
      for (const color of quickColors()) {
        const button = createElement("button", { type: "button", class: "zcf-swatch", text: color, title: "Use " + color + " as primary" });
        button.style.background = color;
        button.style.color = textOn(color);
        button.addEventListener("click", () => setPrimary(color));
        quickRow.appendChild(button);
      }
      const keepQuick = createElement("button", { type: "button", text: "Save primary as quick color" });
      keepQuick.addEventListener("click", () => { saveQuickColor(record.b); status.textContent = record.b ? "Saved " + record.b + " as a quick color." : ""; });
      quickRow.appendChild(keepQuick);

      // ---- whole tree: copy these colors, or a collection, over the folder's subfolders
      const treeFolder = target.folder && subfolderList(target.folder).length ? target.folder : null;
      if (treeFolder) {
        const box = createElement("div", { class: "zcf-tree-box" });
        box.appendChild(createElement("h4", { text: "Whole tree" }));
        const run = (promise) => {
          status.textContent = "Applying…";
          Promise.resolve(promise).then((result) => { if (editor === element) status.textContent = treeResultText(result); })
            .catch((error) => { if (editor === element) status.textContent = "Could not apply: " + (error?.message || error); });
        };
        const rowOne = createElement("div", { class: "zcf-row" });
        const withAll = createElement("button", { type: "button", text: "These colors → folder and all subfolders" });
        const subsOnly = createElement("button", { type: "button", text: "These colors → subfolders only" });
        const copy = (includeRoot) => () => {
          if (mode() !== editMode) setString(P.MODE, editMode);
          const look = current();
          run(applyToTree(treeFolder, () => look, { includeRoot }));
        };
        withAll.addEventListener("click", copy(true));
        subsOnly.addEventListener("click", copy(false));
        rowOne.append(withAll, subsOnly);
        const rowTwo = createElement("div", { class: "zcf-row" });
        const pickCollection = createElement("select", { "aria-label": "Collection to spread over this tree" });
        BUILTIN_THEMES.forEach((group, index) => pickCollection.appendChild(createElement("option", { value: String(index), text: group.group })));
        const spread = createElement("button", { type: "button", text: "Spread collection over this tree" });
        spread.addEventListener("click", () => {
          const pick = collectionPicker(BUILTIN_THEMES[Number(pickCollection.value)]);
          if (pick) run(applyToTree(treeFolder, pick));
        });
        rowTwo.append(pickCollection, spread);
        box.append(rowOne, rowTwo, createElement("div", { class: "zcf-muted", text: "A collection gives this folder its first look, its subfolders the second, theirs the third, and so on." }));
        element.appendChild(box);
      }

      // ---- actions: Reset, Cancel, Apply, Apply and close
      const actions = createElement("div", { class: "zcf-btns" });
      const reset = createElement("button", { type: "button", text: "Reset" });
      const cancel = createElement("button", { type: "button", text: "Close" });
      const apply = createElement("button", { type: "button", text: "Apply" });
      const applyClose = createElement("button", { type: "button", text: "Apply and close" });
      const persist = (value, closeAfter) => {
        // The shared mode is written only when the person applies, never while they browse the tabs.
        if (value && mode() !== editMode) setString(P.MODE, editMode);
        let result;
        try { result = target.write(value); }
        catch (error) {
          if (editor === element) status.textContent = "Could not save: " + (error?.message || error);
          return;
        }
        Promise.resolve(result).then((ok) => {
          // A Notes write may finish after another folder's editor was opened.
          // Never let an older async save dismiss or overwrite the newer UI.
          if (editor !== element) return;
          if (ok === false) {
            status.textContent = target.available === false ? "Notes is not ready yet. Open Notes once, then retry." : "Could not save this folder style.";
            return;
          }
          if (closeAfter) closeEditor();
          else status.textContent = value ? "Applied." : "Reset.";
        }).catch((error) => {
          if (editor === element) status.textContent = "Could not save: " + (error?.message || error);
        });
      };
      const current = () => ({ b: record.b, d: editMode === "simple" ? (record.d.stroke ? { stroke: record.d.stroke } : {}) : record.d, o: record.o });
      reset.addEventListener("click", () => { record = { b: "", d: {}, o: {} }; syncInputs(); persist(null, false); });
      cancel.addEventListener("click", closeEditor);
      apply.addEventListener("click", () => persist(current(), false));
      applyClose.addEventListener("click", () => persist(current(), true));
      actions.append(reset, cancel, apply, applyClose);
      element.appendChild(actions);
      setEditMode(editMode);

      // Use the browser's native popup layer. A normal fixed HTML child can sit
      // underneath Zen's sidebar/popups even with a huge z-index, which makes
      // Apply/Close appear dead. A XUL panel is reliably topmost and keeps the
      // editor's controls hit-testable; the div fallback is for test harnesses.
      try {
        const popupSet = document.getElementById("mainPopupSet");
        if (popupSet && document.createXULElement) {
          const host = document.createXULElement("panel");
          host.setAttribute("noautohide", "true");
          host.setAttribute("level", "top");
          host.setAttribute("role", "dialog");
          host.style.cssText = "-moz-appearance:none!important;padding:0!important;border:0!important;background:transparent!important;overflow:visible!important;";
          host.appendChild(element);
          popupSet.appendChild(host);
          editorHost = host;
        } else {
          document.documentElement.appendChild(element);
          element.style.position = "fixed";
        }
      } catch (_) {
        document.documentElement.appendChild(element);
        element.style.position = "fixed";
      }

      // Position beside the target folder and do not place the panel over it
      // when any usable side/vertical gap exists. The helper also bounds it to
      // the current viewport and is covered by unit tests.
      try {
        const rect = anchor?.getBoundingClientRect?.();
        const width = window.innerWidth || 1200;
        const height = window.innerHeight || 800;
        const placement = placePanel(rect, Math.min(760, width - 16), Math.min(element.scrollHeight || 620, height - 16), width, height);
        element.style.width = placement.width + "px";
        element.style.maxHeight = placement.height + "px";
        if (!editorHost) {
          element.style.left = placement.left + "px";
          element.style.top = placement.top + "px";
        }
        if (editorHost) {
          const screenX = Number(window.mozInnerScreenX ?? window.screenX ?? 0);
          const screenY = Number(window.mozInnerScreenY ?? window.screenY ?? 0);
          editorHost.openPopupAtScreen?.(Math.round(screenX + placement.left), Math.round(screenY + placement.top), false);
        }
      } catch (_) {}

      let drag = null;
      const onPointerDown = (event) => {
        if (event.button !== 0 || event.target?.closest?.("button,input")) return;
        const rect = element.getBoundingClientRect();
        drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, id: event.pointerId };
        try { header.setPointerCapture(event.pointerId); } catch (_) {}
        event.preventDefault();
      };
      const onPointerMove = (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const maxLeft = Math.max(8, (window.innerWidth || 1200) - element.offsetWidth - 8);
        const maxTop = Math.max(8, (window.innerHeight || 800) - 40);
        const left = Math.max(8, Math.min(maxLeft, drag.left + event.clientX - drag.x));
        const top = Math.max(8, Math.min(maxTop, drag.top + event.clientY - drag.y));
        if (editorHost?.moveTo) {
          const screenX = Number(window.mozInnerScreenX ?? window.screenX ?? 0);
          const screenY = Number(window.mozInnerScreenY ?? window.screenY ?? 0);
          editorHost.moveTo(Math.round(screenX + left), Math.round(screenY + top));
        } else {
          element.style.left = left + "px";
          element.style.top = top + "px";
        }
      };
      const onPointerUp = (event) => {
        if (drag && event.pointerId === drag.id) drag = null;
      };
      header.addEventListener("pointerdown", onPointerDown);
      header.addEventListener("pointermove", onPointerMove);
      header.addEventListener("pointerup", onPointerUp);
      header.addEventListener("pointercancel", onPointerUp);
      const onKey = (event) => {
        if (event.key === "Escape") closeEditor();
      };
      window.addEventListener("keydown", onKey, true);
      editorAbort = () => {
        window.removeEventListener("keydown", onKey, true);
        header.removeEventListener("pointerdown", onPointerDown);
        header.removeEventListener("pointermove", onPointerMove);
        header.removeEventListener("pointerup", onPointerUp);
        header.removeEventListener("pointercancel", onPointerUp);
      };
    }

    function makeSwatchIcon(theme) {
      const color = cleanHex(theme.b) || cleanHex(theme.d?.accent) || "#858585";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="2" y="2" width="12" height="12" rx="3" fill="${color}" stroke="#000" stroke-opacity=".35"/></svg>`;
      return "data:image/svg+xml," + encodeURIComponent(svg);
    }
    function buildMenu(popup, folder) {
      const xul = (tag, attrs = {}) => {
        const node = document.createXULElement(tag);
        for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
        node.setAttribute(MENU_MARK, "true");
        return node;
      };
      popup.appendChild(xul("menuseparator"));
      const menu = xul("menu", { label: "Folder colors" });
      const submenu = document.createXULElement("menupopup");
      menu.appendChild(submenu);
      const apply = (theme) => {
        const target = folderTarget(folder);
        if (FOLDER_STYLE.needsDetailed(theme)) setString(P.MODE, "detailed");
        Promise.resolve(target.write({ b: theme.b || "", d: theme.d || {}, o: theme.o || {} }))
          .then((ok) => {
            if (ok === false) console.warn("[Zentral Colorful Folders] Could not apply palette to", target.title);
            else schedulePaint();
          })
          .catch((error) => console.warn("[Zentral Colorful Folders] Palette apply failed:", error));
      };
      const addGroup = (label, items) => {
        const group = document.createXULElement("menu");
        group.setAttribute("label", label);
        const pop = document.createXULElement("menupopup");
        for (const theme of items) {
          const item = document.createXULElement("menuitem");
          item.setAttribute("label", theme.n);
          item.setAttribute("class", "menuitem-iconic");
          item.setAttribute("image", makeSwatchIcon(theme));
          item.addEventListener("command", () => apply(theme));
          pop.appendChild(item);
        }
        group.appendChild(pop);
        return group;
      };
      for (const group of BUILTIN_THEMES) submenu.appendChild(addGroup(group.group, group.items));
      if (state.themes.length)
        submenu.appendChild(addGroup("My quick themes", state.themes));
      submenu.appendChild(xul("menuseparator"));
      const more = xul("menuitem", { label: "More colors…" });
      more.addEventListener("command", () => {
        const open = () => openTargetEditor(folderTarget(folder), folder);
        let opened = false;
        let attempts = 0;
        const isClosed = () => {
          const state = String(popup.state || "").toLowerCase();
          return state === "closed" || popup.hidden === true || popup.isConnected === false;
        };
        const afterHidden = (event) => {
          // A nested submenu can emit popuphidden before its owner. Do not use
          // {once:true}: that would consume the listener on the wrong popup.
          if (event && event.target !== popup) return;
          if (opened || !isClosed()) return;
          opened = true;
          popup.removeEventListener("popuphidden", afterHidden, true);
          lifecycle.setTimeout(() => lifecycle.setTimeout(open, 0), 40);
        };
        const waitUntilClosed = () => {
          if (opened || !lifecycle.active) return;
          if (isClosed()) return afterHidden();
          // Keep nudging the native popup closed while its XUL hide transition
          // runs. Only open the floating editor after the context menu is gone.
          if (attempts % 8 === 0) {
            try { popup.hidePopup?.(); } catch (_) {}
          }
          if (attempts++ >= 120) {
            popup.removeEventListener("popuphidden", afterHidden, true);
            console.warn("[Zentral Colorful Folders] native color menu did not close; editor was not opened over it");
            return;
          }
          lifecycle.setTimeout(waitUntilClosed, 25);
        };
        popup.addEventListener("popuphidden", afterHidden, true);
        try { popup.hidePopup?.(); } catch (_) {}
        lifecycle.setTimeout(waitUntilClosed, 0);
      });
      submenu.appendChild(more);
      if (subfolderList(folder).length) {
        const wholeTree = xul("menu", { label: "Whole tree (this folder + subfolders)" });
        const treePop = document.createXULElement("menupopup");
        wholeTree.appendChild(treePop);
        const run = (promise) => Promise.resolve(promise).catch((error) =>
          console.warn("[Zentral Colorful Folders] tree apply failed:", error));
        const own = xul("menuitem", { label: "Copy this folder's colors to all subfolders" });
        const record = folderTarget(folder).read();
        if (!FOLDER_STYLE.hasColor(FOLDER_STYLE.norm(record || {}))) own.setAttribute("disabled", "true");
        own.addEventListener("command", () => {
          const look = FOLDER_STYLE.norm(folderTarget(folder).read() || {});
          if (FOLDER_STYLE.hasColor(look)) run(applyToTree(folder, () => look, { includeRoot: false }));
        });
        treePop.appendChild(own);
        treePop.appendChild(xul("menuseparator"));
        const paletteMenu = xul("menu", { label: "Apply a palette to folder and subfolders" });
        const palettePop = document.createXULElement("menupopup");
        for (const group of BUILTIN_THEMES.concat(state.themes.length ? [{ group: "My quick themes", items: state.themes }] : [])) {
          const groupMenu = document.createXULElement("menu");
          groupMenu.setAttribute("label", group.group);
          const groupPop = document.createXULElement("menupopup");
          for (const theme of group.items) {
            const item = document.createXULElement("menuitem");
            item.setAttribute("label", theme.n);
            item.setAttribute("class", "menuitem-iconic");
            item.setAttribute("image", makeSwatchIcon(theme));
            item.addEventListener("command", () => run(applyToTree(folder, () => theme)));
            groupPop.appendChild(item);
          }
          groupMenu.appendChild(groupPop);
          palettePop.appendChild(groupMenu);
        }
        paletteMenu.appendChild(palettePop);
        treePop.appendChild(paletteMenu);
        const collectionMenu = xul("menu", { label: "Spread a collection over this tree" });
        const collectionPop = document.createXULElement("menupopup");
        for (const group of BUILTIN_THEMES) {
          const pick = collectionPicker(group);
          if (!pick) continue;
          const item = document.createXULElement("menuitem");
          item.setAttribute("label", group.group);
          item.addEventListener("command", () => run(applyToTree(folder, pick)));
          collectionPop.appendChild(item);
        }
        collectionMenu.appendChild(collectionPop);
        treePop.appendChild(collectionMenu);
        submenu.appendChild(wholeTree);
      }
      const reset = xul("menuitem", { label: "Reset to default" });
      reset.addEventListener("command", () => {
        Promise.resolve(folderTarget(folder).write(null)).catch((error) =>
          console.warn("[Zentral Colorful Folders] folder reset failed:", error),
        );
      });
      submenu.appendChild(reset);
      popup.appendChild(menu);
    }
    function onPopupShowing(event) {
      const popup = event.target;
      if (!popup || popup.id !== "zenFolderActions") return;
      try {
        for (const old of [...popup.querySelectorAll?.("[" + MENU_MARK + "]") || []]) old.remove();
        if (!enabled() || !menuEnabled()) return;
        const candidates = [popup.triggerNode, event.originalTarget, popup.anchorNode];
        const findFolder = (node) => {
          try {
            const closest = node?.closest?.("zen-folder");
            if (closest) return closest;
            for (let current = node; current && current !== popup; current = current.parentNode || current.host)
              if (current.localName === "zen-folder") return current;
          } catch (_) {}
          return null;
        };
        const folder = candidates.map(findFolder).find(Boolean);
        if (folder) buildMenu(popup, folder);
      } catch (error) {
        console.warn("[Zentral Colorful Folders] context menu failed:", error);
      }
    }
    lifecycle.listen(window, "popupshowing", onPopupShowing, true);
    lifecycle.listen(window, "zentral-notes-folder-color-bridge-ready", schedulePaint);
    lifecycle.listen(window, "zentral-notes-folder-color-bridge-gone", schedulePaint);
    lifecycle.own(() => {
      try {
        for (const node of [...document.querySelectorAll?.("[" + MENU_MARK + "]") || []]) node.remove();
      } catch (_) {}
    });

    // Observe only the native tab tree, never the whole browser document. The
    // bounded first passes cover session-restore timing; subsequent folders,
    // renames and Notes ownership changes are handled by this narrow observer.
    const root =
      document.getElementById("tabbrowser-tabs") ||
      window.gBrowser?.tabContainer ||
      document.querySelector?.("#tabbrowser-tabs");
    if (root) {
      lifecycle.listen(root, "click", onAccentLineClick, true);
      lifecycle.listen(root, "pointerover", updateLineHover, true);
      lifecycle.listen(root, "pointermove", updateLineHover, true);
      lifecycle.listen(root, "pointerleave", clearLineHover, true);
      lifecycle.listen(window, "blur", clearLineHover, true);
    }
    if (root && typeof MutationObserver === "function") {
      observer = new MutationObserver(() => schedulePaint());
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "id",
          "label",
          "bgalazka-notes-color",
          "bgalazka-notes-folder",
          "bgalazka-notes-subfolder",
        ],
      });
      lifecycle.own(() => {
        observer?.disconnect();
        observer = null;
      });
    }
    for (const type of ["TabOpen", "TabClose", "TabAttrModified", "aftercustomization"])
      lifecycle.listen(window, type, schedulePaint, true);
    for (const delay of [0, 800, 2500, 7000]) lifecycle.setTimeout(schedulePaint, delay);

    lifecycle.preference(PREFIX, (_subject, _topic, name) => {
      if (name === P.DATA) {
        const raw = getString(P.DATA, "");
        if (raw !== state.dataRaw) {
          state.dataRaw = raw;
          state.data = parseData(raw);
        }
      } else if (name === P.THEMES) {
        const raw = getString(P.THEMES, "");
        if (raw !== state.themesRaw) {
          state.themesRaw = raw;
          state.themes = parseThemes(raw);
        }
      }
      schedulePaint();
    });
    lifecycle.preference("zen.workspace.bgalazka.look.folder_", schedulePaint);
    // Changing a default never flips the mode and never touches a folder's own record: a folder with its own colors
    // ignores every default (see FOLDER_STYLE.resolve).
    lifecycle.preference(PREFIX + "default_", (_subject, _topic, name) => {
      if (name === P.LAYERS) {
        const raw = getString(P.LAYERS, "");
        if (raw !== state.layersRaw) state.layersRaw = raw;
      }
      schedulePaint();
    });
    // Switches for the individual parts of the folder styling and the native accent-line interactions.
    const onStyleSwitch = () => {
      syncRootFlags();
      schedulePaint();
      announceDefaultsChanged();
    };
    lifecycle.preference(PREFIX + "style_", onStyleSwitch);
    lifecycle.preference(PREFIX + "line_", onStyleSwitch);
    lifecycle.preference(P.IGNORE_LABEL, schedulePaint);
    lifecycle.preference(P.MODE, schedulePaint);
    lifecycle.preference(P.ENABLED, schedulePaint);

    settingsUnregister = runtime?.registerSettingsHook?.("colorful-folders", 31, () => {
      const modal = document.getElementById("zentral-settings-modal");
      if (!modal) return;

      // Appearance > Colorful folders > Defaults. Choose where a look goes (every level, or one nesting level) and click a
      // look; a collection button spreads its looks over levels 1-5. A folder with its own colors is never touched.
      const defaultsSection = runtime.ensureSettingsSection?.(modal, "folder-colors", "Defaults");
      if (defaultsSection && !defaultsSection.querySelector("#zentral-colorful-folders-showcase")) {
        const showcase = createElement("div", { id: "zentral-colorful-folders-showcase" });
        showcase.appendChild(createElement("p", {
          class: "zcf-muted",
          text: "Defaults apply to folders without their own colors, in Zen and in Notes. Pick a level, then a look. A collection spreads its looks over the levels (top-level folder, subfolder, second subfolder...).",
        }));
        let scope = 0;
        const scopeRow = createElement("div", { class: "zcf-tabs", role: "group", "aria-label": "Apply a look to" });
        const scopeButtons = [];
        const scopeNames = ["All levels", "Level 1", "Level 2", "Level 3", "Level 4", "Level 5"];
        const defaultPicker = createElement("input", { type: "color", class: "zcf-default-color", "aria-label": "Default color for the selected level" });
        const syncScope = () => {
          scopeButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === scope)));
          defaultPicker.value = defaultTarget(scope).read().b || "#667788";
        };
        scopeNames.forEach((name, index) => {
          const button = createElement("button", { type: "button", text: name, title: LEVEL_NAMES[index] });
          button.addEventListener("click", () => { scope = index; syncScope(); });
          scopeButtons.push(button);
          scopeRow.appendChild(button);
        });
        showcase.appendChild(scopeRow);
        const defaultPickerRow = createElement("div", { class: "zcf-row" });
        defaultPicker.addEventListener("input", () => {
          const target = defaultTarget(scope);
          const current = target.read();
          // The direct picker is the Simple control: it replaces the layers and keeps only transparency and the outline.
          target.write({ b: defaultPicker.value, d: current.d?.stroke ? { stroke: current.d.stroke } : {}, o: current.o });
          setString(P.MODE, "simple");
        });
        defaultPickerRow.append(createElement("span", { text: "Primary color for the selected level" }), defaultPicker);
        showcase.appendChild(defaultPickerRow);
        const defaultActions = createElement("div", { class: "zcf-btns" });
        const editDefaults = createElement("button", { type: "button", text: "Customize all seven layers and transparency…" });
        editDefaults.addEventListener("click", () => openEditor(defaultTarget(scope), modal));
        const resetDefaults = createElement("button", { type: "button", text: "Reset this level" });
        resetDefaults.addEventListener("click", () => { defaultTarget(scope).write(null); syncScope(); });
        const resetAll = createElement("button", { type: "button", text: "Reset all defaults" });
        resetAll.addEventListener("click", () => {
          for (let level = 0; level <= FOLDER_STYLE.MAX_DEPTH; level++) defaultTarget(level).write(null);
          syncScope();
        });
        defaultActions.append(editDefaults, resetDefaults, resetAll);
        showcase.appendChild(defaultActions);
        const ignoreRow = createElement("label", { class: "zcf-check" });
        const ignoreBox = createElement("input", { type: "checkbox", "aria-label": "Ignore my folder label color" });
        ignoreBox.checked = getBool(P.IGNORE_LABEL, false);
        ignoreBox.addEventListener("change", () => { setBool(P.IGNORE_LABEL, ignoreBox.checked); schedulePaint(); });
        ignoreRow.append(ignoreBox, createElement("span", { text: "Ignore my folder label color (let the Zen theme decide; turn on if a theme makes names unreadable)" }));
        showcase.appendChild(ignoreRow);
        for (const group of BUILTIN_THEMES) {
          const heading = createElement("h4", { text: group.group });
          const spread = createElement("button", { type: "button", text: "Spread over levels 1-5", title: `Apply the ${group.group} collection: level 1 gets the first look, level 2 the second...` });
          spread.addEventListener("click", () => { if (applyCollectionToLevels(group)) { scope = 0; syncScope(); } });
          showcase.append(heading, createElement("div", { class: "zcf-btns" }, spread));
          const grid = createElement("div", { class: "zcf-showcase" });
          for (const theme of group.items) {
            const back = cleanHex(theme.d?.back) || theme.b;
            const front = cleanHex(theme.d?.front) || theme.b;
            const stroke = cleanHex(theme.d?.stroke) || theme.b;
            const button = createElement("button", { type: "button", title: `Apply ${theme.n} to all default folders` });
            const icon = createElement("span", { class: "zcf-showcase-icon", "aria-hidden": "true" });
            icon.style.setProperty("--zcf-back", back);
            icon.style.setProperty("--zcf-front", front);
            icon.style.setProperty("--zcf-stroke", stroke);
            button.append(icon, createElement("small", { text: theme.n }));
            button.addEventListener("click", () => {
              if (FOLDER_STYLE.needsDetailed(theme)) setString(P.MODE, "detailed");
              const ok = scope ? defaultTarget(scope).write(theme) : applyLookEverywhere(theme);
              if (ok) {
                syncScope();
                for (const item of showcase.querySelectorAll(".zcf-showcase button")) item.dataset.active = item === button ? "true" : "false";
              }
            });
            grid.appendChild(button);
          }
          showcase.appendChild(grid);
        }
        syncScope();
        defaultsSection.appendChild(showcase);
      }

      const section = runtime.ensureSettingsSection?.(modal, "folder-colors", "Your folders");
      if (!section || section.querySelector("#zentral-colorful-folders-list")) return;
      const list = createElement("div", { id: "zentral-colorful-folders-list" });
      const makeRow = (name, target, folder, record, notesOwned = false) => {
        const preview = createElement("span", { class: "zcf-preview", "aria-hidden": "true" });
        preview.style.background = previewBackground(record || {});
        const edit = createElement("button", { type: "button", text: "Colors…" });
        const reset = createElement("button", { type: "button", text: "Reset" });
        edit.disabled = target.available === false;
        edit.title = notesOwned ? "Edit this Notes folder; Notes storage will be synchronized automatically" : "Edit this folder's colors";
        reset.disabled = !hasColor(record || {});
        edit.addEventListener("click", () => openTargetEditor(target, folder || modal));
        reset.addEventListener("click", () => {
          Promise.resolve(target.write(null)).then((ok) => {
            if (ok !== false) fill();
          }).catch((error) => console.warn("[Zentral Colorful Folders] reset failed:", error));
        });
        return createElement(
          "div",
          { class: "zcf-list-row" },
          preview,
          createElement("span", { class: "zcf-name", text: notesOwned ? name + " · Notes" : name }),
          edit,
          reset,
        );
      };
      let fillGeneration = 0;
      const fill = async () => {
        const generation = ++fillGeneration;
        let notesBridgeReady = notesBridge();
        if (!notesBridgeReady) notesBridgeReady = await waitForNotesBridge(900);
        if (notesBridgeReady?.prepare) {
          try { await notesBridgeReady.prepare(); } catch (error) { console.warn("[Zentral Colorful Folders] Notes style load failed:", error); }
        }
        if (generation !== fillGeneration || list.isConnected === false || !lifecycle.active) return;
        list.replaceChildren();
        const defaults = defaultRecord();
        const defaultRow = makeRow("All folders (default look)", defaultTarget(), null, defaults);
        list.appendChild(defaultRow);
        const levels = layerRecords();
        for (let level = 1; level <= FOLDER_STYLE.MAX_DEPTH; level++)
          if (levels[level]) list.appendChild(makeRow(LEVEL_NAMES[level], defaultTarget(level), null, levels[level]));
        const folders = liveFolders();
        if (!folders.length)
          list.appendChild(createElement("p", { class: "zcf-muted", text: "No native folders are currently visible in this window." }));
        for (const folder of folders) {
          const notesOwned = isNotesOwned(folder);
          const title = String(folder.getAttribute("label") || folder.label || (folder.id === "bgalazka-zentral-notes" ? "NOTES" : "Folder"));
          const target = folderTarget(folder);
          const record = target.read() || {};
          list.appendChild(makeRow(title, target, folder, record, notesOwned));
        }
        const refresh = createElement("button", { type: "button", text: "Refresh list" });
        refresh.addEventListener("click", fill);
        list.appendChild(createElement("div", { class: "zcf-btns" }, refresh));
      };
      fill();
      section.appendChild(list);
      lifecycle.listen(window, "zentral-notes-folder-color-bridge-ready", () => fill());
      lifecycle.listen(window, "zentral-notes-folder-style-changed", () => {
        schedulePaint();
        fill();
      });
      lifecycle.listen(window, "zentral-folder-color-presets-ready", () => fill());
    });
    lifecycle.own(() => {
      settingsUnregister?.();
      settingsUnregister = null;
      closeEditor();
      document.getElementById("zentral-colorful-folders-list")?.remove();
    });
    lifecycle.own(() => {
      if (paintTimer !== null) lifecycle.clearTimeout(paintTimer);
      paintTimer = null;
      for (const folder of [...painted]) clearFolderPaint(folder);
    });
    schedulePaint();
  }

  // Test seam: pure functions only; production behaviour still enters through
  // the same registration and lifecycle path as every other Zentral feature.
  try {
    window.__zentralColorfulFoldersTestSeam = Object.freeze({
      cleanHex,
      cleanRecord,
      cleanDetail,
      cleanOpacity,
      parseData,
      serializeData,
      parseThemes,
      cleanTheme,
      derive,
      partsFor,
      declarations,
      FOLDER_STYLE,
      placePanel,
      sha256Hex,
      hashKey,
      BUILTIN_THEMES,
      PARTS,
      PART_LABELS,
      MARK,
      MENU_MARK,
    });
  } catch (_) {}

  (window.ZentralRuntime || window.__zentralStandaloneRuntime).register({
    id: "colorful-folders",
    init: start,
  });
})();
