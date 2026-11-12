/*
 * ZENTRAL FILE GUIDE - additional/notes/flavors/ZentralNotesFlavors.js
 *
 * Purpose: The Markdown flavor MODES of Notes as pure logic: which syntax the parser accepts in each mode.
 * Interaction / execution: ZentralNotes.uc.js loads this file (full pack: module loader; standalone: embedded
 *   include) and asks `gate(mode).on("A10")` before it uses a rule that other apps read differently. Nothing here
 *   touches the DOM, the network or a preference; a missing file means "mixed, everything on" (the old behaviour).
 * Ownership / failure: The feature table is GENERATED from docs/MARKDOWN_FLAVORS.md by
 *   tools/build-flavors-data.cjs (the doc is the source of truth; --check fails when they differ).
 * Registration: notes-flavors
 * Loaded/created by: additional/notes/ZentralNotes.uc.js
 *
 * MODES (the pref `markdown_flavor`)
 *   mixed            the default: accept what the three apps accept; where two apps give the same symbols a
 *                    different meaning, the default written in the doc wins (see MIXED_PICK).
 *   mixed+obsidian   mixed, but every collision follows Obsidian.   (same for mixed+github, mixed+reddit)
 *   obsidian         Obsidian only: a rule is on only when core Obsidian does it. (same for github, reddit)
 * Plugin-only syntax (the doc's plug symbol) is NOT core, so it is off in the "only" modes and on in every mixed mode.
 */
(function () {
  "use strict";
  /*__FEATURES_BEGIN__*/
  // id: [github, obsidian, reddit, notes today, mixed]. github/obsidian/reddit: y yes, p partly, t only as an HTML tag,
  // x plugin or theme, n no. mixed: ON, ON+guard, PICK, OFF. GENERATED from docs/MARKDOWN_FLAVORS.md; do not edit.
  const FEATURES = {
  "A01": ["y", "y", "y", "H", "ON"],
  "A02": ["y", "y", "y", "H", "ON"],
  "A03": ["y", "y", "y", "H", "ON"],
  "A04": ["y", "y", "y", "H", "ON"],
  "A05": ["y", "y", "y", "H", "ON"],
  "A06": ["y", "y", "y", "H", "ON"],
  "A07": ["y", "y", "y", "H", "ON"],
  "A08": ["y", "y", "y", "H", "ON"],
  "A09": ["y", "n", "n", "H", "PICK"],
  "A10": ["n", "y", "n", "H", "ON"],
  "A11": ["n", "n", "n", "H", "ON"],
  "A12": ["y", "y", "y", "H", "ON"],
  "A13": ["n", "x", "n", "H", "ON"],
  "A14": ["t", "t", "n", "H", "ON"],
  "A15": ["n", "x", "n", "H", "ON"],
  "A16": ["t", "t", "n", "H", "ON"],
  "A17": ["n", "n", "y", "H", "PICK"],
  "A18": ["n", "t", "n", "H", "ON"],
  "A19": ["t", "t", "n", "H", "ON"],
  "A20": ["n", "n", "n", "H", "ON"],
  "A21": ["n", "t", "n", "H", "ON"],
  "A22": ["t", "t", "n", "H", "ON"],
  "A23": ["t", "t", "n", "H", "ON"],
  "A24": ["t", "t", "n", "H", "ON"],
  "A25": ["n", "t", "n", "H", "ON+guard"],
  "A26": ["t", "t", "n", "H", "ON+guard"],
  "A27": ["n", "n", "y", "H", "PICK"],
  "A28": ["n", "n", "y", "N", "OFF"],
  "A29": ["n", "n", "n", "H", "ON+guard"],
  "A30": ["n", "y", "n", "H", "ON"],
  "A31": ["n", "y", "n", "H", "ON+guard"],
  "A32": ["y", "y", "n", "H", "ON"],
  "A33": ["y", "y", "y", "H", "ON"],
  "B01": ["y", "y", "y", "H", "ON"],
  "B02": ["y", "y", "y", "P", "ON"],
  "B03": ["y", "y", "n", "H", "ON"],
  "B04": ["y", "y", "y", "H", "ON"],
  "B05": ["y", "y", "n", "H", "ON"],
  "B06": ["y", "y", "n", "P", "ON"],
  "B07": ["y", "y", "y", "H", "ON"],
  "B08": ["y", "y", "y", "H", "ON"],
  "B09": ["y", "y", "y", "H", "ON"],
  "B10": ["y", "y", "y", "H", "ON"],
  "B11": ["y", "y", "y", "H", "ON"],
  "B12": ["y", "n", "p", "H", "ON+guard"],
  "B13": ["y", "y", "n", "H", "ON"],
  "B14": ["y", "n", "n", "N", "OFF"],
  "B15": ["y", "y", "p", "H", "ON"],
  "B16": ["y", "y", "n", "P", "ON"],
  "B17": ["n", "y", "n", "H", "ON"],
  "B18": ["y", "y", "n", "H", "ON"],
  "B19": ["y", "y", "n", "H", "ON"],
  "B20": ["t", "t", "n", "P", "ON"],
  "B21": ["y", "y", "n", "N", "OFF"],
  "B22": ["t", "n", "n", "N", "OFF"],
  "B23": ["n", "t", "n", "N", "OFF"],
  "B24": ["n", "y", "n", "N", "ON+guard"],
  "C01": ["p", "y", "n", "H", "ON"],
  "C02": ["p", "y", "n", "H", "ON"],
  "C03": ["n", "y", "n", "N", "ON"],
  "C04": ["n", "y", "n", "N", "ON"],
  "C05": ["n", "y", "n", "N", "ON"],
  "C06": ["n", "y", "n", "N", "ON"],
  "C07": ["n", "y", "n", "N", "ON+guard"],
  "C08": ["n", "y", "n", "N", "ON+guard"],
  "C09": ["n", "y", "n", "N", "ON+guard"],
  "C10": ["n", "y", "n", "N", "ON"],
  "C11": ["n", "y", "n", "N", "ON"],
  "C12": ["n", "y", "n", "N", "OFF"],
  "C13": ["n", "y", "n", "N", "OFF"],
  "C14": ["n", "y", "n", "H", "ON+guard"],
  "C15": ["n", "y", "n", "N", "ON"],
  "C16": ["n", "y", "n", "N", "ON"],
  "C17": ["n", "y", "n", "P", "ON"],
  "C18": ["n", "y", "n", "H", "ON"],
  "D01": ["y", "y", "y", "H", "ON"],
  "D02": ["n", "n", "y", "H", "PICK"],
  "D03": ["y", "y", "y", "H", "ON"],
  "D04": ["y", "y", "y", "P", "ON"],
  "D05": ["n", "n", "n", "H", "ON"],
  "D06": ["n", "n", "n", "N", "OFF"],
  "D07": ["y", "y", "n", "N", "OFF"],
  "D08": ["y", "y", "n", "P", "ON"],
  "D09": ["n", "n", "n", "N", "OFF"],
  "E01": ["y", "y", "y", "H", "ON"],
  "E02": ["y", "y", "y", "H", "ON"],
  "E03": ["y", "y", "n", "H", "ON"],
  "E04": ["y", "y", "n", "H", "ON"],
  "E05": ["y", "y", "y", "H", "ON"],
  "E06": ["y", "y", "y", "H", "ON"],
  "E07": ["y", "y", "y", "H", "ON"],
  "E08": ["y", "y", "n", "H", "ON"],
  "E09": ["n", "x", "n", "H", "ON"],
  "E10": ["n", "x", "n", "H", "ON"],
  "E11": ["n", "n", "n", "H", "ON"],
  "E12": ["n", "n", "n", "H", "ON+guard"],
  "E13": ["y", "y", "y", "B", "ON"],
  "E14": ["y", "y", "p", "H", "ON"],
  "E15": ["y", "y", "p", "B", "ON"],
  "E16": ["y", "y", "n", "N", "ON"],
  "E17": ["y", "y", "n", "N", "OFF"],
  "E18": ["n", "n", "n", "N", "OFF"],
  "E19": ["n", "n", "n", "H", "ON+guard"],
  "E20": ["y", "y", "y", "P", "ON"],
  "F01": ["y", "y", "y", "H", "ON"],
  "F02": ["y", "y", "y", "H", "ON"],
  "F03": ["y", "y", "y", "B", "ON"],
  "F04": ["y", "y", "p", "H", "ON"],
  "F05": ["y", "y", "n", "H", "ON"],
  "F06": ["y", "y", "n", "H", "ON"],
  "F07": ["y", "y", "n", "H", "ON"],
  "F08": ["y", "y", "n", "H", "ON"],
  "F09": ["y", "y", "n", "H", "ON"],
  "F10": ["n", "y", "n", "H", "ON"],
  "F11": ["n", "y", "n", "H", "ON"],
  "F12": ["n", "y", "n", "H", "ON"],
  "F13": ["n", "y", "n", "H", "ON"],
  "F14": ["n", "y", "n", "H", "ON"],
  "F15": ["n", "y", "n", "H", "ON"],
  "F16": ["n", "y", "n", "H", "ON"],
  "F17": ["n", "y", "n", "H", "ON"],
  "F18": ["n", "y", "n", "H", "ON"],
  "F19": ["n", "y", "n", "H", "ON"],
  "F20": ["n", "y", "n", "H", "ON"],
  "F21": ["n", "y", "n", "H", "ON"],
  "F22": ["n", "y", "n", "H", "ON"],
  "F23": ["n", "y", "n", "H", "ON"],
  "F24": ["n", "x", "n", "H", "ON+guard"],
  "F25": ["y", "y", "n", "H", "ON"],
  "F26": ["n", "x", "n", "H", "ON"],
  "F27": ["n", "x", "n", "H", "ON"],
  "G01": ["y", "y", "p", "H", "ON"],
  "G02": ["y", "y", "n", "H", "ON"],
  "G03": ["y", "y", "n", "H", "ON"],
  "G04": ["y", "p", "n", "H", "ON"],
  "G05": ["y", "y", "y", "H", "PICK"],
  "G06": ["y", "y", "n", "P", "ON"],
  "G07": ["y", "y", "n", "H", "ON"],
  "G08": ["y", "n", "n", "H", "ON"],
  "G09": ["y", "y", "n", "P", "OFF"],
  "G10": ["y", "n", "n", "N", "OFF"],
  "G11": ["y", "y", "n", "H", "ON"],
  "G12": ["y", "y", "p", "B", "ON"],
  "H01": ["y", "y", "y", "H", "ON"],
  "H02": ["y", "y", "y", "H", "ON"],
  "H03": ["y", "y", "n", "H", "ON"],
  "H04": ["y", "y", "y", "H", "ON"],
  "H05": ["y", "y", "y", "H", "ON"],
  "H06": ["y", "y", "n", "H", "ON"],
  "H07": ["y", "y", "y", "H", "ON"],
  "H08": ["y", "y", "n", "H", "ON"],
  "H09": ["n", "n", "n", "H", "ON"],
  "H10": ["n", "n", "n", "N", "OFF"],
  "H11": ["t", "t", "n", "H", "ON"],
  "H12": ["n", "n", "n", "N", "OFF"],
  "I01": ["y", "y", "n", "P", "ON"],
  "I02": ["y", "y", "n", "P", "ON"],
  "I03": ["y", "y", "n", "H", "ON"],
  "I04": ["n", "n", "n", "H", "ON"],
  "I05": ["n", "n", "n", "H", "ON"],
  "I06": ["y", "y", "n", "N", "ON"],
  "I07": ["y", "y", "n", "H", "ON"],
  "I08": ["y", "n", "n", "H", "ON"],
  "I09": ["y", "x", "n", "N", "OFF"],
  "I10": ["y", "y", "n", "P", "OFF"],
  "J01": ["y", "y", "n", "H", "ON"],
  "J02": ["y", "y", "n", "H", "ON"],
  "J03": ["n", "y", "n", "H", "ON"],
  "J04": ["y", "y", "n", "H", "ON"],
  "J05": ["y", "y", "y", "H", "ON"],
  "J06": ["y", "y", "n", "P", "ON"],
  "J07": ["n", "n", "n", "N", "OFF"],
  "J08": ["y", "y", "y", "H", "ON"],
  "J09": ["y", "y", "n", "H", "ON"],
  "J10": ["p", "p", "p", "H", "ON"],
  "J11": ["y", "y", "y", "H", "ON"],
  "J12": ["y", "y", "y", "H", "ON"],
  "J13": ["y", "y", "p", "H", "ON"],
  "J14": ["n", "y", "n", "N", "OFF"],
  "K01": ["y", "y", "n", "H", "ON"],
  "K02": ["y", "y", "n", "H", "ON"],
  "K03": ["y", "y", "n", "H", "ON"],
  "K04": ["y", "y", "n", "H", "ON"],
  "K05": ["y", "y", "n", "H", "ON"],
  "K06": ["y", "y", "n", "H", "ON"],
  "K07": ["y", "y", "n", "N", "ON"],
  "K08": ["y", "y", "n", "N", "ON"],
  "K09": ["y", "y", "n", "N", "ON"],
  "K10": ["y", "y", "n", "N", "ON"],
  "K11": ["y", "y", "n", "N", "OFF"],
  "K12": ["n", "n", "n", "N", "OFF"],
  "L01": ["y", "n", "n", "N", "OFF"],
  "L02": ["y", "n", "n", "N", "OFF"],
  "L03": ["y", "n", "n", "N", "OFF"],
  "L04": ["n", "n", "y", "H", "PICK"],
  "L05": ["y", "x", "p", "H", "ON+guard"],
  "L06": ["y", "n", "n", "N", "OFF"],
  "L07": ["n", "n", "n", "H", "ON"],
  "M01": ["y", "y", "y", "H", "ON"],
  "M02": ["y", "y", "y", "H", "ON"],
  "M03": ["y", "y", "y", "H", "ON"],
  "M04": ["y", "y", "p", "B", "ON"],
  "M05": ["y", "y", "n", "H", "ON"],
  "M06": ["n", "n", "n", "H", "ON"],
  "M07": ["y", "y", "n", "H", "ON"],
  "M08": ["y", "y", "y", "H", "ON"],
  "M09": ["y", "y", "y", "H", "ON"],
  "M10": ["y", "y", "p", "H", "ON"],
  "M11": ["y", "y", "n", "H", "ON"],
  "M12": ["n", "n", "n", "P", "ON+guard"],
  "M13": ["y", "y", "n", "H", "ON"],
  "M14": ["y", "y", "n", "H", "ON"],
  "M15": ["n", "y", "n", "H", "ON"],
  "M16": ["y", "y", "n", "H", "ON"],
  "M17": ["y", "y", "n", "H", "ON"],
  "M18": ["y", "y", "y", "P", "ON"],
  "M19": ["y", "y", "p", "H", "ON"],
  "M20": ["y", "y", "n", "P", "OFF"],
  "M21": ["y", "y", "n", "H", "ON"],
  "M22": ["n", "y", "n", "H", "ON"],
  "M23": ["y", "y", "n", "P", "ON"],
  "M24": ["n", "n", "y", "H", "PICK"],
  "N01": ["n", "y", "n", "H", "ON"],
  "N02": ["n", "y", "n", "H", "ON"],
  "N03": ["n", "n", "n", "H", "ON"],
  "N04": ["n", "n", "n", "H", "ON+guard"],
  "N05": ["n", "n", "n", "H", "ON+guard"],
  "N06": ["n", "n", "n", "H", "ON+guard"],
  "N07": ["n", "n", "n", "H", "ON+guard"],
  "N08": ["n", "y", "n", "H", "ON"],
  "N09": ["n", "n", "n", "N", "ON+guard"],
  "N10": ["n", "x", "n", "N", "OFF"],
  "N11": ["n", "n", "n", "N", "OFF"],
  "O01": ["n", "n", "n", "H", "ON"],
  "O02": ["n", "n", "n", "N", "OFF"],
  "O03": ["n", "n", "n", "H", "OFF"],
  "O04": ["n", "n", "n", "H", "ON"],
  "O05": ["n", "n", "n", "H", "OFF"],
  };
  /*__FEATURES_END__*/

  const MODES = Object.freeze(["mixed", "mixed+obsidian", "mixed+github", "mixed+reddit", "obsidian", "github", "reddit"]);
  const MODE_LABELS = Object.freeze({
    mixed: "Mixed (accept what all three apps accept)",
    "mixed+obsidian": "Mixed, collisions follow Obsidian",
    "mixed+github": "Mixed, collisions follow GitHub",
    "mixed+reddit": "Mixed, collisions follow Reddit",
    obsidian: "Obsidian only",
    github: "GitHub only",
    reddit: "Reddit only",
  });
  const FLAVORS = Object.freeze(["github", "obsidian", "reddit"]);
  const COL = { github: 0, obsidian: 1, reddit: 2 };
  const SUPPORTS = { y: true, p: true, t: true, x: false, n: false }; // x = plugin or theme: not core

  const cleanMode = (v) => (MODES.includes(v) ? v : "mixed");
  function parseMode(v) {
    const mode = cleanMode(v);
    if (mode === "mixed") return { mode, only: false, flavor: null };
    if (mode.startsWith("mixed+")) return { mode, only: false, flavor: mode.slice(6) };
    return { mode, only: true, flavor: mode };
  }

  // Rows whose symbols mean different things in different apps (the PICK rows). In plain mixed they take this value;
  // in mixed+X they follow what X does with the symbols.
  const MIXED_PICK = Object.freeze({ A09: false, A17: false, A27: true, D02: false, G05: false, L04: false, M24: false });
  // Rows that are ON in mixed but use symbols the chosen flavor reads another way: switched off in that mixed+X mode.
  const FLIP_OFF = Object.freeze({
    A13: ["github"], // H~2~O: GitHub reads ~a~ as strikethrough
    A15: ["reddit"], // X^2^: Reddit reads ^ as superscript
    C07: ["reddit"], // block id ^abc: same caret
    C14: ["reddit"], // #tag: Reddit reads #a as a heading
  });

  // Our own recognitions that no app has but that change nothing about the text (a date gets a dotted underline and a
  // data-ymd for the calendar): they stay on in the "only" modes too.
  const OURS = Object.freeze(new Set(["L07"]));

  function supports(flavor, id) {
    const row = FEATURES[id];
    return !!row && !!SUPPORTS[row[COL[flavor]]];
  }
  // true when the parser should apply the rule `id` in `mode`. An id that is not in the table is never gated.
  function enabled(modeValue, id) {
    const row = FEATURES[id];
    if (!row) return true;
    const { only, flavor } = parseMode(modeValue);
    const verdict = row[4];
    if (only && OURS.has(id)) return true;
    if (only) return verdict !== "OFF" && supports(flavor, id);
    if (verdict === "OFF") return false;
    if (verdict === "PICK") return flavor ? supports(flavor, id) : !!MIXED_PICK[id];
    if (flavor && FLIP_OFF[id]?.includes(flavor)) return false;
    return true;
  }
  // gate("github").on("A10") - one object per parse so a rule reads like a plain flag.
  // opts.tilde: "strike" makes ~a~ strikethrough in the mixed modes (default: subscript, see COLLISION 1).
  // opts.ignore: a Set of feature ids the person switched off ("ignore this syntax" setting).
  function gate(modeValue, opts = {}) {
    const info = parseMode(modeValue);
    const cache = new Map();
    const strike = !info.only && opts.tilde === "strike";
    const off = opts.ignore instanceof Set ? opts.ignore : null;
    return {
      mode: info.mode,
      only: info.only,
      flavor: info.flavor,
      on(id) {
        if (!cache.has(id)) {
          let v = enabled(info.mode, id);
          if (strike && !info.flavor) v = id === "A09" ? true : id === "A13" ? false : v;
          if (off && off.has(id)) v = false;
          cache.set(id, v);
        }
        return cache.get(id);
      },
    };
  }
  // The "ignore syntax" setting: words separated by spaces or commas. A feature id (A10, F10) switches that rule off;
  // anything else is a piece of syntax that must show as plain text (">[!info]", "<mark>", "=="). Max 40 words.
  function parseIgnore(text) {
    const ids = new Set(), literals = [];
    for (const w of String(text || "").split(/[\s,]+/).filter(Boolean).slice(0, 40)) {
      if (/^[A-Za-z]\d{2}$/.test(w)) ids.add(w.toUpperCase());
      else if (w.length <= 40) literals.push(w);
    }
    literals.sort((a, b) => b.length - a.length); // the longer piece first: "==" must not eat "=={red}"
    return { ids, literals };
  }
  // Fences of things we cannot draw: the block is still shown as code, with an error callout above it.
  const UNSUPPORTED_FENCES = Object.freeze(["mermaid", "plantuml", "puml", "dot", "graphviz", "geojson", "topojson", "stl", "chart", "vega", "vega-lite", "flowchart", "sequence", "d2", "tikz"]);
  // Every id switched on in a mode (for tests and for the doc's counters).
  const enabledIds = (modeValue) => Object.keys(FEATURES).filter((id) => enabled(modeValue, id));

  // ---- callout kinds ---------------------------------------------------------------------------------------------
  // Canonical kind (what the look and the CSS are keyed by) and the feature row that gates it. GitHub alerts are
  // note / tip / important / warning / caution; Obsidian has thirteen with aliases. Our look keeps the six we had.
  const CALLOUTS = Object.freeze({
    note: ["note", "F05"], tip: ["tip", "F06"], important: ["important", "F07"], warning: ["warning", "F08"], caution: ["caution", "F09"],
    info: ["info", "F10"],
    abstract: ["abstract", "F11"], summary: ["abstract", "F11"], tldr: ["abstract", "F11"],
    todo: ["todo", "F12"],
    success: ["success", "F13"], check: ["success", "F13"], done: ["success", "F13"],
    question: ["question", "F14"], help: ["question", "F14"], faq: ["question", "F14"],
    failure: ["failure", "F15"], fail: ["failure", "F15"], missing: ["failure", "F15"],
    danger: ["danger", "F16"], error: ["danger", "F16"],
    bug: ["bug", "F17"],
    example: ["example", "F18"],
    quote: ["quote", "F19"], cite: ["quote", "F19"],
    hint: ["tip", "F20"], attention: ["warning", "F20"],
    bingo: ["bingo", "F26"], poll: ["poll", "F27"],
  });
  const CALLOUT_LOOKS = Object.freeze(["note", "tip", "important", "warning", "caution", "info", "abstract", "todo", "success", "question", "failure", "danger", "bug", "example", "quote", "bingo", "poll"]);
  // "[!Summary]" -> { kind: "abstract", type: "summary", known: true }. An unknown type is a "note" look that keeps
  // its own name as the title (Obsidian does the same); null when the mode does not read callouts of that type.
  function calloutKind(raw, g) {
    const type = String(raw || "").toLowerCase();
    if (!/^[a-z][\w-]{0,30}$/.test(type)) return null;
    const hit = CALLOUTS[type];
    if (hit) return !g || g.on(hit[1]) ? { kind: hit[0], type, known: true } : null;
    return !g || g.on("F24") || (g.only && g.flavor === "obsidian") ? { kind: "note", type, known: false } : null;
  }

  // Shortcode -> character, known names only (a made-up :name: stays text). The common GitHub / Slack / Discord set.
  const EMOJI = Object.freeze(Object.fromEntries(
    ("+1 👍;-1 👎;thumbsup 👍;thumbsdown 👎;smile 😄;smiley 😃;grin 😁;laughing 😆;joy 😂;wink 😉;blush 😊;heart_eyes 😍;sunglasses 😎;thinking 🤔;neutral_face 😐;" +
      "unamused 😒;sweat_smile 😅;cry 😢;sob 😭;angry 😠;rage 😡;scream 😱;sleeping 😴;confused 😕;innocent 😇;relaxed ☺️;slightly_smiling_face 🙂;upside_down_face 🙃;" +
      "heart ❤️;broken_heart 💔;blue_heart 💙;green_heart 💚;yellow_heart 💛;purple_heart 💜;star ⭐;star2 🌟;sparkles ✨;fire 🔥;boom 💥;zap ⚡;tada 🎉;confetti_ball 🎊;" +
      "rocket 🚀;trophy 🏆;medal 🏅;gift 🎁;bulb 💡;bell 🔔;mag 🔍;lock 🔒;unlock 🔓;key 🔑;link 🔗;paperclip 📎;pushpin 📌;memo 📝;pencil2 ✏️;book 📖;books 📚;" +
      "calendar 📅;date 📅;clock1 🕐;hourglass ⌛;alarm_clock ⏰;warning ⚠️;no_entry ⛔;x ❌;white_check_mark ✅;heavy_check_mark ✔️;check ✔️;question ❓;exclamation ❗;" +
      "bangbang ‼️;information_source ℹ️;bug 🐛;wrench 🔧;hammer 🔨;gear ⚙️;package 📦;computer 💻;iphone 📱;email 📧;envelope ✉️;phone ☎️;globe_with_meridians 🌐;" +
      "sunny ☀️;cloud ☁️;umbrella ☔;snowflake ❄️;rainbow 🌈;earth_africa 🌍;seedling 🌱;evergreen_tree 🌲;rose 🌹;coffee ☕;pizza 🍕;beer 🍺;cake 🍰;apple 🍎;" +
      "dog 🐶;cat 🐱;bird 🐦;turtle 🐢;see_no_evil 🙈;eyes 👀;wave 👋;clap 👏;pray 🙏;muscle 💪;ok_hand 👌;point_right 👉;point_left 👈;raised_hands 🙌;handshake 🤝;" +
      "100 💯;arrow_right ➡️;arrow_left ⬅️;arrow_up ⬆️;arrow_down ⬇️;recycle ♻️;moneybag 💰;chart_with_upwards_trend 📈;chart_with_downwards_trend 📉;house 🏠;car 🚗;airplane ✈️").split(";")
      .map((x) => { const i = x.indexOf(" "); return [x.slice(0, i), x.slice(i + 1)]; }),
  ));

  const api = { EMOJI, parseIgnore, UNSUPPORTED_FENCES, FEATURES, MODES, MODE_LABELS, FLAVORS, cleanMode, parseMode, supports, enabled, gate, enabledIds, MIXED_PICK, FLIP_OFF, CALLOUTS, CALLOUT_LOOKS, calloutKind };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.ZentralModuleLoader?.define) window.ZentralModuleLoader.define("notes-flavors", () => api);
})();
