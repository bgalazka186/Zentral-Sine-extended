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
  });
  const PARTS = Object.freeze([
    "back",
    "front",
    "stroke",
    "label",
    "accent",
    "tint",
    "hover",
  ]);
  const PART_LABELS = Object.freeze({
    back: "Icon: back",
    front: "Icon: front",
    stroke: "Icon: outline and glyph",
    label: "Folder label",
    accent: "Accent and group line",
    tint: "Soft background tint",
    hover: "Hover background",
  });
  const PART_PREFS = Object.freeze(
    Object.fromEntries(PARTS.map((part) => [part, PREFIX + "default_" + part])),
  );
  const OPACITY_PREFS = Object.freeze(
    Object.fromEntries(PARTS.map((part) => [part, PREFIX + "default_" + part + "_opacity"])),
  );
  const PART_PROPS = Object.freeze({
    back: ["--zen-folder-behind-bgcolor"],
    front: ["--zen-folder-front-bgcolor"],
    stroke: ["--zen-folder-stroke"],
    label: ["--bgalazka-fc-label"],
    accent: [
      "--tab-group-color",
      "--tab-group-background-color",
      "--tab-group-color-invert",
      "--tab-group-text-color",
      "--tab-group-text-color-invert",
    ],
    tint: ["--tab-group-color-pale"],
    hover: ["--tab-group-background-color-hover"],
  });
  const MARK = "bgalazka-folder-colors";
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
  const cleanHex = (value) =>
    typeof value === "string" && HEX_RE.test(value.trim())
      ? value.trim().toLowerCase()
      : "";
  const cleanHash = (value) =>
    typeof value === "string" && HASH_RE.test(value) ? value : "";
  const cleanDetail = (raw) => {
    const out = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw))
      for (const part of PARTS) {
        const value = cleanHex(raw[part]);
        if (value) out[part] = value;
      }
    return out;
  };
  const cleanOpacity = (raw) => {
    const out = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const part of PARTS) {
        const value = Number(raw[part]);
        if (
          raw[part] !== undefined &&
          raw[part] !== null &&
          Number.isFinite(value) &&
          Number.isInteger(value) &&
          value >= 0 &&
          value <= 100
        ) {
          out[part] = value;
        }
      }
    }
    return out;
  };
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
  const luminance = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const linear = (value) => {
      const s = value / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return (
      0.2126 * linear((n >> 16) & 255) +
      0.7152 * linear((n >> 8) & 255) +
      0.0722 * linear(n & 255)
    );
  };
  const textOn = (hex) =>
    luminance(hex) > 0.4 ? "#1b1b1f" : "#ffffff";
  const mix = (hex, percent, other) =>
    `color-mix(in srgb, ${hex} ${percent}%, ${other})`;
  function derive(base) {
    const color = cleanHex(base);
    if (!color) return {};
    return {
      back: `light-dark(${mix(color, 60, "gray")}, ${mix(color, 60, "#c1c1c1")})`,
      front: `light-dark(color-mix(in srgb, ${color}, white 70%), color-mix(in srgb, ${color}, black 40%))`,
      stroke: `light-dark(${mix(color, 50, "black")}, ${mix(color, 15, "#ebebeb")})`,
      label: `light-dark(${mix(color, 55, "black")}, ${mix(color, 55, "white")})`,
      accent: color,
      tint: mix(color, 22, "transparent"),
      hover: mix(color, 85, "white"),
    };
  }
  function partsFor(record, mode = "simple") {
    if (!record) return {};
    const base = cleanHex(record.b);
    const detail = cleanDetail(record.d);
    const out = base ? derive(base) : {};
    if (!base || mode === "detailed")
      for (const part of PARTS)
        if (detail[part])
          out[part] =
            part === "tint" ? mix(detail[part], 22, "transparent") : detail[part];
    const accent = cleanHex(
      !base || mode === "detailed" ? detail.accent || base : base,
    );
    if (out.accent && accent) out.accentText = textOn(accent);
    return out;
  }
  function declarations(parts, opacity = {}) {
    const out = {};
    const alpha = cleanOpacity(opacity);
    const withOpacity = (value, part) => {
      const pct = alpha[part];
      return pct === undefined || pct >= 100 ? value : `color-mix(in srgb, ${value} ${pct}%, transparent)`;
    };
    for (const part of PARTS) {
      const rawValue = parts?.[part];
      if (!rawValue) continue;
      const value = withOpacity(rawValue, part);
      if (part === "accent") {
        const on = parts.accentText || "#ffffff";
        const off = on === "#ffffff" ? "#1b1b1f" : "#ffffff";
        out["--tab-group-color"] = value;
        out["--tab-group-background-color"] = value;
        out["--tab-group-color-invert"] = off;
        out["--tab-group-text-color"] = on;
        out["--tab-group-text-color-invert"] = off;
      } else {
        for (const property of PART_PROPS[part]) out[property] = value;
      }
    }
    return out;
  }

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

  const BUILTIN_THEMES = Object.freeze([
    {
      group: "Dark folders",
      items: [
        { n: "Graphite", b: "#343a40", d: {}, o: {} },
        { n: "Midnight", b: "#202b3b", d: {}, o: {} },
        { n: "Deep forest", b: "#234236", d: {}, o: {} },
        { n: "Plum shadow", b: "#493047", d: {}, o: {} },
      ],
    },
    {
      group: "High contrast",
      items: [
        { n: "Amber", b: "#d97706", d: { front: "#ffe0a3", stroke: "#3b2100" }, o: {} },
        { n: "Aqua", b: "#087e8b", d: { front: "#b9f4f4", stroke: "#032f36" }, o: {} },
        { n: "Rose", b: "#be3455", d: { front: "#ffd2df", stroke: "#3d0716" }, o: {} },
        { n: "Electric blue", b: "#2557d6", d: { front: "#d8e5ff", stroke: "#071b50" }, o: {} },
      ],
    },
    {
      group: "Colorful",
      items: [
        { n: "Coral", b: "#ff8066", d: {}, o: {} },
        { n: "Mint", b: "#40b99a", d: {}, o: {} },
        { n: "Lavender", b: "#9c83e6", d: {}, o: {} },
        { n: "Sunflower", b: "#e5bd38", d: {}, o: {} },
      ],
    },
  ]);

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
    function defaultRecord() {
      const detail = {};
      const opacity = {};
      for (const part of PARTS) {
        const value = cleanHex(getString(PART_PREFS[part], ""));
        if (value) detail[part] = value;
        const alpha = getInt(OPACITY_PREFS[part], -1);
        if (alpha >= 0 && alpha <= 100) opacity[part] = alpha;
      }
      return {
        b: cleanHex(getString(P.BASE, "")),
        d: detail,
        o: opacity,
      };
    }
    function opacityColor(value, opacity) {
      const color = cleanHex(value);
      if (!color) return "";
      const pct = Math.max(0, Math.min(100, Math.round(Number(opacity))));
      return pct >= 100 ? color : `color-mix(in srgb, ${color} ${pct}%, transparent)`;
    }
    function defaultOpacity() {
      const opacity = { ...defaultRecord().o };
      for (const [part, legacy] of [
        ["back", LEGACY_DEFAULTS.backOpacity],
        ["front", LEGACY_DEFAULTS.frontOpacity],
        ["stroke", LEGACY_DEFAULTS.strokeOpacity],
      ]) {
        if (opacity[part] !== undefined) continue;
        const value = getInt(legacy, 100);
        if (value >= 0 && value < 100) opacity[part] = value;
      }
      return opacity;
    }
    function defaultParts() {
      const parts = partsFor(defaultRecord(), mode());
      // Preserve old Appearance values only for components the new defaults do
      // not explicitly own. A newly chosen base color must remain authoritative.
      const record = defaultRecord();
      if (!record.b) {
        for (const [part, key, opacityKey] of [
          ["back", LEGACY_DEFAULTS.back, LEGACY_DEFAULTS.backOpacity],
          ["front", LEGACY_DEFAULTS.front, LEGACY_DEFAULTS.frontOpacity],
          ["stroke", LEGACY_DEFAULTS.stroke, LEGACY_DEFAULTS.strokeOpacity],
        ]) {
          if (record.d[part]) continue;
          const color = cleanHex(getString(key, ""));
          if (color) parts[part] = opacityColor(color, getInt(opacityKey, 100));
        }
        if (!record.d.label) {
          const label = cleanHex(getString(LEGACY_DEFAULTS.label, ""));
          if (label) parts.label = label;
        }
      }
      if (parts.accent && !parts.accentText) parts.accentText = textOn(cleanHex(parts.accent) || "#202020");
      return parts;
    }
    function resolveStyle(rawRecord = null) {
      const defaults = defaultRecord();
      const record = rawRecord && typeof rawRecord === "object" ? rawRecord : {};
      const base = cleanHex(record.b || record.color) || defaults.b;
      const detail = { ...defaults.d, ...cleanDetail(record.d || record.parts) };
      const effective = { b: base, d: detail };
      const parts = partsFor(effective, mode());
      // Retain the legacy Appearance values only when no new base or part owns
      // that layer. This path is read-only and disappears after migration.
      if (!base) {
        for (const [part, key, opacityKey] of [
          ["back", LEGACY_DEFAULTS.back, LEGACY_DEFAULTS.backOpacity],
          ["front", LEGACY_DEFAULTS.front, LEGACY_DEFAULTS.frontOpacity],
          ["stroke", LEGACY_DEFAULTS.stroke, LEGACY_DEFAULTS.strokeOpacity],
        ]) {
          if (!parts[part] && !detail[part]) {
            const legacy = cleanHex(getString(key, ""));
            if (legacy) parts[part] = opacityColor(legacy, getInt(opacityKey, 100));
          }
        }
        if (!parts.label && !detail.label) {
          const legacy = cleanHex(getString(LEGACY_DEFAULTS.label, ""));
          if (legacy) parts.label = legacy;
        }
      }
      const accent = cleanHex(parts.accent) || base;
      if (accent) parts.accentText = textOn(accent);
      const opacity = { ...defaultOpacity(), ...cleanOpacity(record.o || record.opacity) };
      return { base, parts, opacity, properties: declarations(parts, opacity) };
    }
    function styleMapFor(folder) {
      if (isNotesOwned(folder)) return {};
      return resolveStyle(readFolderRecord(folder)).properties;
    }
    const previousStyleBridge = window.__zentralFolderColorStyleBridge;
    const folderColorStyleBridge = Object.freeze({
      version: 1,
      resolve: (record) => resolveStyle(record),
      defaults: () => resolveStyle(null),
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
        painted.add(folder);
      } else {
        folder.removeAttribute(MARK);
        painted.delete(folder);
      }
    }
    function paintAll() {
      paintTimer = null;
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
      .zcf-panel { position: relative; z-index: 2147483647; width: 330px; max-width: calc(100vw - 20px);
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
      .zcf-opacity { display:flex; align-items:center; gap:5px; min-width:112px; }
      .zcf-opacity input { width:72px; }
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
    function defaultTarget() {
      return {
        title: "All folders (default look)",
        read: () => defaultRecord(),
        write: (record) => {
          const next = record ? { b: cleanHex(record.b), d: cleanDetail(record.d), o: cleanOpacity(record.o) } : null;
          if (!setString(P.BASE, next?.b || "")) return false;
          if (next && (Object.keys(next.d).length || Object.keys(next.o).length))
            setString(P.MODE, "detailed");
          for (const part of PARTS) {
            if (!setString(PART_PREFS[part], next?.d?.[part] || "")) return false;
            if (!setInt(OPACITY_PREFS[part], next?.o?.[part] ?? -1)) return false;
          }
          schedulePaint();
          return true;
        },
      };
    }
    function folderTarget(folder) {
      const title = String(folder.getAttribute("label") || folder.label || "Folder");
      if (isNotesOwned(folder)) {
        return {
          title,
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
                const colors = declarations(partsFor(value, mode()), value.o);
                for (const property of Object.keys(PART_PROPS).flatMap((part) => PART_PROPS[part])) {
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
        available: true,
        read: () => readFolderRecord(folder),
        write: (record) => setFolderRecord(folder, record),
      };
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
    function openEditor(target, anchor) {
      closeEditor();
      const element = createElement("div", {
        class: "zcf-panel",
        role: "dialog",
        "aria-label": "Folder colors",
      });
      editor = element;
      let record = target.read() || { b: "", d: {}, o: {} };
      record = { b: cleanHex(record.b), d: cleanDetail(record.d), o: cleanOpacity(record.o) };
      const header = createElement("div", { class: "zcf-header" });
      const heading = createElement("h3", { text: `Colors · ${target.title}` });
      const close = createElement("button", { type: "button", class: "zcf-close", text: "×", "aria-label": "Close color editor" });
      header.append(heading, close);
      close.addEventListener("click", closeEditor);
      const baseLabel = createElement("div", { class: "zcf-muted", text: "Choose a coordinated base style, then fine tune individual layers and transparency. Changes are saved only when you press Apply." });
      const baseRow = createElement("div", { class: "zcf-row" });
      const base = createElement("input", { type: "color", "aria-label": "Folder base color" });
      base.value = record.b || defaultRecord().b || "#667788";
      const baseHex = createElement("input", { type: "text", maxlength: "7", spellcheck: "false", "aria-label": "Base color as hex", placeholder: "auto" });
      baseHex.value = record.b;
      const autoBase = createElement("button", { type: "button", text: "Auto" });
      baseRow.append(createElement("span", { text: "Base color" }), base, baseHex, autoBase);
      const partInputs = new Map();
      const setBase = (value) => {
        const color = cleanHex(value);
        if (!color) return;
        record.b = color;
        base.value = color;
        baseHex.value = color;
        for (const [part, input] of partInputs) {
          if (!record.d[part]) input.color.value = color;
        }
      };
      base.addEventListener("input", () => setBase(base.value));
      baseHex.addEventListener("input", () => {
        const raw = baseHex.value.trim();
        const value = cleanHex(raw.startsWith("#") ? raw : "#" + raw);
        if (value) setBase(value);
      });
      autoBase.addEventListener("click", () => { record.b = ""; baseHex.value = ""; });
      element.append(header, baseLabel, baseRow);

      const syncPartInputs = () => {
        for (const [part, input] of partInputs) {
          input.hex.value = record.d[part] || "";
          input.color.value = record.d[part] || record.b || defaultRecord().d[part] || defaultRecord().b || "#667788";
          input.opacity.value = String(record.o[part] === undefined ? 100 : record.o[part]);
          input.opacityValue.textContent = record.o[part] === undefined ? "Auto" : record.o[part] + "%";
        }
      };
      const builtins = createElement("div", { class: "zcf-swatches" });
      for (const group of BUILTIN_THEMES)
        for (const theme of group.items) {
          const button = createElement("button", { type: "button", class: "zcf-swatch", text: theme.n, title: group.group + " · " + theme.n });
          button.style.background = previewBackground(theme);
          button.addEventListener("click", () => {
            if (Object.keys(theme.d || {}).length || Object.keys(theme.o || {}).length)
              setString(P.MODE, "detailed");
            record = { b: theme.b, d: cleanDetail(theme.d), o: cleanOpacity(theme.o) };
            setBase(theme.b);
            syncPartInputs();
          });
          builtins.appendChild(button);
        }
      element.append(createElement("h4", { text: "Shared quick palette" }), builtins);

      const detail = createElement("details", { class: "zcf-detail" });
      const summary = createElement("summary", { text: "Fine tune each layer · color and transparency" });
      const detailRows = createElement("div", {});
      detail.append(summary, detailRows);
      for (const part of PARTS) {
        const row = createElement("div", { class: "zcf-row" });
        row.style.flexWrap = "wrap";
        const color = createElement("input", { type: "color", "aria-label": PART_LABELS[part] });
        color.value = record.d[part] || record.b || defaultRecord().d[part] || defaultRecord().b || "#667788";
        const hex = createElement("input", { type: "text", maxlength: "7", spellcheck: "false", placeholder: "auto", "aria-label": PART_LABELS[part] + " as hex" });
        hex.value = record.d[part] || "";
        const opacityBox = createElement("span", { class: "zcf-opacity" });
        const opacity = createElement("input", { type: "range", min: "0", max: "100", step: "1", "aria-label": PART_LABELS[part] + " transparency" });
        opacity.value = String(record.o[part] === undefined ? 100 : record.o[part]);
        const opacityValue = createElement("output", { text: record.o[part] === undefined ? "Auto" : record.o[part] + "%" });
        opacityBox.append(createElement("span", { text: "Opacity (0% = transparent)" }), opacity, opacityValue);
        const auto = createElement("button", { type: "button", text: "Auto" });
        const ensureDetailedMode = () => {
          if (mode() !== "detailed") setString(P.MODE, "detailed");
        };
        const setPart = (value) => {
          const clean = cleanHex(value);
          if (!clean) return;
          ensureDetailedMode();
          record.d[part] = clean;
          color.value = clean;
          hex.value = clean;
        };
        color.addEventListener("input", () => setPart(color.value));
        hex.addEventListener("input", () => {
          const raw = hex.value.trim();
          const value = cleanHex(raw.startsWith("#") ? raw : "#" + raw);
          if (value) setPart(value);
        });
        opacity.addEventListener("input", () => {
          ensureDetailedMode();
          record.o[part] = Number(opacity.value);
          opacityValue.textContent = opacity.value + "%";
        });
        auto.addEventListener("click", () => {
          delete record.d[part];
          delete record.o[part];
          hex.value = "";
          color.value = record.b || defaultRecord().d[part] || defaultRecord().b || "#667788";
          opacity.value = "100";
          opacityValue.textContent = "Auto";
        });
        row.append(createElement("span", { text: PART_LABELS[part] }), color, hex, opacityBox, auto);
        detailRows.appendChild(row);
        partInputs.set(part, { color, hex, opacity, opacityValue });
      }
      if (mode() === "detailed" && (Object.keys(record.d).length || Object.keys(record.o).length)) detail.open = true;
      element.appendChild(detail);

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
      const actions = createElement("div", { class: "zcf-btns" });
      const reset = createElement("button", { type: "button", text: "Reset" });
      const cancel = createElement("button", { type: "button", text: "Cancel" });
      const save = createElement("button", { type: "button", text: "Apply" });
      const writeAndClose = (value) => {
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
          closeEditor();
        }).catch((error) => {
          if (editor === element) status.textContent = "Could not save: " + (error?.message || error);
        });
      };
      reset.addEventListener("click", () => writeAndClose(null));
      cancel.addEventListener("click", closeEditor);
      save.addEventListener("click", () => writeAndClose({ b: record.b, d: record.d, o: record.o }));
      actions.append(reset, cancel, save);
      element.appendChild(actions);

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
        const placement = placePanel(
          rect,
          Math.min(380, width - 16),
          Math.min(element.scrollHeight || 620, height - 16),
          width,
          height,
        );
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
        if (Object.keys(theme.d || {}).length || Object.keys(theme.o || {}).length)
          setString(P.MODE, "detailed");
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
    lifecycle.preference(PREFIX + "default_", (_subject, _topic, name) => {
      const key = String(name || "");
      if (key !== P.BASE && mode() !== "detailed") {
        const isOpacity = key.endsWith("_opacity");
        const active = isOpacity
          ? getInt(key, -1) >= 0
          : !!cleanHex(getString(key, ""));
        if (active) setString(P.MODE, "detailed");
      }
      schedulePaint();
    });
    lifecycle.preference(P.MODE, schedulePaint);
    lifecycle.preference(P.ENABLED, schedulePaint);

    settingsUnregister = runtime?.registerSettingsHook?.("colorful-folders", 31, () => {
      const modal = document.getElementById("zentral-settings-modal");
      if (!modal) return;

      // Appearance > Colorful folders > Defaults: the showcase applies one
      // consistent style to every ordinary Zen folder and to Notes folders
      // that do not have their own per-folder overrides.
      const defaultsSection = runtime.ensureSettingsSection?.(modal, "folder-colors", "Defaults");
      if (defaultsSection && !defaultsSection.querySelector("#zentral-colorful-folders-showcase")) {
        const showcase = createElement("div", { id: "zentral-colorful-folders-showcase" });
        showcase.appendChild(createElement("p", {
          class: "zcf-muted",
          text: "Choose a coordinated showcase for every folder, including Notes. Use the color picker for the linked base color or open the detailed editor to tune all seven layers and their transparency.",
        }));
        const defaultPickerRow = createElement("div", { class: "zcf-row" });
        const defaultPicker = createElement("input", { type: "color", class: "zcf-default-color", "aria-label": "Default color for all folders" });
        defaultPicker.value = defaultRecord().b || "#667788";
        defaultPicker.addEventListener("input", () => {
          const current = defaultRecord();
          // The direct picker is the linked-color/simple control. It clears
          // individual color overrides but retains explicit transparency.
          defaultTarget().write({ b: defaultPicker.value, d: {}, o: current.o });
          setString(P.MODE, "simple");
        });
        defaultPickerRow.append(
          createElement("span", { text: "Default color for all folders" }),
          defaultPicker,
        );
        showcase.appendChild(defaultPickerRow);
        const defaultActions = createElement("div", { class: "zcf-btns" });
        const editDefaults = createElement("button", { type: "button", text: "Customize all seven layers and transparency…" });
        editDefaults.addEventListener("click", () => openEditor(defaultTarget(), modal));
        defaultActions.appendChild(editDefaults);
        showcase.appendChild(defaultActions);
        for (const group of BUILTIN_THEMES) {
          showcase.appendChild(createElement("h4", { text: group.group }));
          const grid = createElement("div", { class: "zcf-showcase" });
          for (const theme of group.items) {
            const parts = partsFor(theme, "detailed");
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
              const ok = defaultTarget().write(theme);
              if (ok) {
                defaultPicker.value = theme.b;
                showcase.dataset.active = theme.n;
                for (const item of grid.querySelectorAll("button")) item.dataset.active = item === button ? "true" : "false";
              }
            });
            grid.appendChild(button);
          }
          showcase.appendChild(grid);
        }
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
