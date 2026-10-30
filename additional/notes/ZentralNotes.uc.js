/*
 * ZENTRAL FILE GUIDE - additional/notes/ZentralNotes.uc.js
 *
 * Purpose: Quick notes. A note sheet opens over the page area of the Zentral panel whose bar you used
 *   (primary URL bar, Triple View / Super Pin bar), or as a floating card from a shortcut. Notes are plain
 *   Markdown files in a folder of your profile (or a folder you choose), never preferences.
 * Interaction / execution: Optional dock (preference) opens the floating card beside the Zen sidebar and adds a
 *   Notes button to the sidebar's bottom row. One shared store per window; every sheet shows the same notes and stays in sync,
 *   also across windows (observer notification + re-read of the changed file). Saving is a debounce with a
 *   maximum wait: shortly after you stop typing, and at least every few seconds while you keep typing.
 *   The page, panel tab and browser are never navigated, reparented or unloaded by this file.
 * Ownership / failure: Owns its buttons, sheets, observers, timers and the notes folder contents it created.
 *   A failed write keeps the note dirty and retries; nothing is discarded. No panel suite dependency: without
 *   Zentral panels only the shortcut + floating card exist (standalone mode waits for browser readiness).
 * Layout: store (files) -> pure core (format, markdown, edit helpers) -> sheet UI -> bar/host bindings.
 * Registration: notes
 * Loaded/created by: loader/ZentralCatalog.js
 * Literal DOM event subscriptions: unload
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime || window.__zentralStandaloneRuntime;

  function standaloneReady(start) {
    let started = false;
    const run = () => {
      if (started || !window.gBrowser) return;
      started = true;
      try {
        Services.obs.removeObserver(
          observer,
          "browser-delayed-startup-finished",
        );
      } catch (_) {}
      start();
    };
    const observer = {
      observe(subject, topic) {
        if (subject === window && topic === "browser-delayed-startup-finished")
          run();
      },
    };
    if (
      window.gBrowser &&
      (!window.gBrowserInit || window.gBrowserInit.delayedStartupFinished)
    )
      run();
    else {
      Services.obs.addObserver(observer, "browser-delayed-startup-finished");
      window.addEventListener(
        "unload",
        () => {
          try {
            Services.obs.removeObserver(
              observer,
              "browser-delayed-startup-finished",
            );
          } catch (_) {}
        },
        { once: true },
      );
      if (window.gBrowserInit?.delayedStartupFinished) run();
    }
  }

  (function () {
    // ======================================================================
    // Constants
    // ======================================================================
    const PREF = Object.freeze({
      ENABLED: "zen.workspace.zentral.notes.enabled",
      SHOW_BUTTON: "zen.workspace.zentral.notes.show_button",
      SHORTCUT: "zen.workspace.zentral.notes.shortcut",
      FOLDER: "zen.workspace.zentral.notes.folder",
      DOCK_SIDEBAR: "zen.workspace.zentral.notes.dock_sidebar",
      AUTOSAVE: "zen.workspace.zentral.notes.autosave_seconds",
      WRAP: "zen.workspace.zentral.notes.wrap_lines",
      FONT_SIZE: "zen.workspace.zentral.notes.font_size",
      LINE_HEIGHT: "zen.workspace.zentral.notes.line_height",
      BLANK_LINES: "zen.workspace.zentral.notes.blank_lines",
      LINE_BREAKS: "zen.workspace.zentral.notes.line_breaks",
      READ_COPY: "zen.workspace.zentral.notes.read_copy",
      SETEXT: "zen.workspace.zentral.notes.setext",
      PASTE_LINK: "zen.workspace.zentral.notes.paste_link",
      SHORTCUTS: "zen.workspace.zentral.notes.shortcuts",
      HIDDEN_TOOLS: "zen.workspace.zentral.notes.hidden_tools",
      AVOID_SIDEBAR: "zen.workspace.zentral.notes.avoid_sidebar",
      HOVER_REVEAL: "zen.workspace.zentral.notes.hover_reveal",
      PUSH_PAGE: "zen.workspace.zentral.notes.push_page",
      SPLIT_WINDOW: "zen.workspace.zentral.notes.split_window",
      THEME: "zen.workspace.zentral.notes.theme",
    });
    const VIEW_PREFS = new Set([PREF.WRAP, PREF.FONT_SIZE, PREF.LINE_HEIGHT, PREF.READ_COPY, PREF.THEME]);
    const WINDOW_PREFS = new Set([PREF.HOVER_REVEAL, PREF.PUSH_PAGE, PREF.SPLIT_WINDOW, PREF.AVOID_SIDEBAR]);
    const READ_PREFS = new Set([PREF.BLANK_LINES, PREF.LINE_BREAKS, PREF.SETEXT]);
    const OBS_TOPIC = "zentral-notes-changed";
    const IDLE_SAVE_MS = 800; // pause after the last keystroke
    const DEFAULT_MAX_SAVE_SECONDS = 5; // longest gap while still typing
    const TRASH_DAYS = 30;
    const NOTE_COLORS = ["none", "yellow", "green", "blue", "pink", "purple"];
    const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "orange", "purple", "red", "teal"];
    const FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,120}\.md$/;
    const FRONT_KEYS = new Set([
      "id",
      "created",
      "updated",
      "color",
      "label",
      "pinned",
      "trashed",
    ]);
    // A free-text label per note: one short line, no front matter breaking characters.
    const LABEL_MAX = 40;
    const cleanLabel = (v) => String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX).trim();
    const MAX_LIST_ROWS = 300;
    const MAX_INLINE_CHARS = 20000;
    const MAX_TABLE_COLS = 12;
    const MAX_TABLE_ROWS = 200;
    const PREVIEW_IDLE_MS = 250; // split view: re-render this long after the last keystroke
    const MAX_HIGHLIGHT_CHARS = 20000; // longer code blocks are shown without syntax colors
    const MAX_IMPORT_FILES = 500;
    const MAX_IMPORT_BYTES = 1024 * 1024;
    const MAX_RECENT = 8; // notes remembered in the "Recent" list
    const HOLD_MS = 450; // a press longer than this is a "hold" on buttons that have a second action
    const DRAG_SLOP = 3; // pixels before a press on the title becomes a drag
    const TOOLBAR_WIDGET_ID = "zentral-notes-toolbar-button";

    // ======================================================================
    // Pure core: note file format
    // ======================================================================
    const normalizeNewlines = (s) => String(s).replace(/\r\n?/g, "\n");
    const toTime = (value, fallback) => {
      const t = Date.parse(value);
      return Number.isFinite(t) ? t : fallback;
    };
    const iso = (t) => new Date(t).toISOString();

    function makeId(now = Date.now(), rnd = Math.random) {
      return (
        "n" +
        now.toString(36) +
        "-" +
        Math.floor(rnd() * 36 ** 4)
          .toString(36)
          .padStart(4, "0")
      );
    }

    // Files without our header (a .md dropped into the folder) are still
    // notes. A leading "---" block only counts as a header when it contains
    // at least one key we own, so other apps' front matter stays visible text.
    function parseNoteText(text) {
      text = normalizeNewlines(text).replace(/^\uFEFF/, "");
      const meta = {};
      let body = text;
      const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
      if (m) {
        let known = 0;
        const found = {};
        for (const line of m[1].split("\n")) {
          const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
          if (kv && FRONT_KEYS.has(kv[1])) {
            found[kv[1]] = kv[2].trim();
            known++;
          }
        }
        if (known) {
          Object.assign(meta, found);
          body = text.slice(m[0].length);
        }
      }
      return { meta, body };
    }

    function noteFromFile(id, text, mtime) {
      const { meta, body } = parseNoteText(text);
      return {
        id,
        body,
        created: toTime(meta.created, mtime),
        updated: toTime(meta.updated, mtime),
        color: NOTE_COLORS.includes(meta.color) ? meta.color : "none",
        label: cleanLabel(meta.label),
        pinned: meta.pinned === "true",
        trashed: meta.trashed ? toTime(meta.trashed, mtime) : 0,
        _onDisk: true,
        _mtime: mtime,
      };
    }

    function serializeNote(n) {
      const lines = [
        "id: " + n.id,
        "created: " + iso(n.created),
        "updated: " + iso(n.updated),
      ];
      if (n.color && n.color !== "none") lines.push("color: " + n.color);
      if (cleanLabel(n.label)) lines.push("label: " + cleanLabel(n.label));
      if (n.pinned) lines.push("pinned: true");
      if (n.trashed) lines.push("trashed: " + iso(n.trashed));
      return "---\n" + lines.join("\n") + "\n---\n" + n.body;
    }

    const MARKERS_RE = /\*\*|==(?:\{\w+\})?|~~|`/g;
    const LEAD_RE =
      /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/;
    function cleanLine(raw) {
      return raw.replace(LEAD_RE, "").replace(MARKERS_RE, "").trim();
    }
    function titleOf(body) {
      for (const raw of String(body).split("\n")) {
        const line = cleanLine(raw);
        if (line) return line.length > 80 ? line.slice(0, 79) + "\u2026" : line;
      }
      return "";
    }
    function snippetOf(body) {
      let seenTitle = false;
      for (const raw of String(body).split("\n")) {
        const line = cleanLine(raw);
        if (!line) continue;
        if (!seenTitle) {
          seenTitle = true;
          continue;
        }
        return line.length > 90 ? line.slice(0, 89) + "\u2026" : line;
      }
      return "";
    }
    const wordCount = (body) =>
      (String(body).match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) || []).length;
    const safeFileName = (title, fallback = "note") =>
      (String(title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() ||
        fallback
      )
        .replace(/^\.+/, "_")
        .slice(0, 60);

    // ======================================================================
    // Pure core: autosave scheduler (debounce + maximum wait)
    // ======================================================================
    // touch() marks work pending. The work runs `idleMs` after the LAST
    // touch, but never later than `maxMs` after the FIRST touch since the
    // previous run, so typing without pause still saves on a relaxed loop.
    function createAutosaver({ idleMs, maxMs, flush, setTimer, clearTimer }) {
      let idle = null,
        max = null,
        pending = false;
      const clear = () => {
        if (idle !== null) clearTimer(idle);
        if (max !== null) clearTimer(max);
        idle = max = null;
      };
      const run = () => {
        clear();
        if (!pending) return undefined;
        pending = false;
        return flush();
      };
      return {
        touch() {
          pending = true;
          if (idle !== null) clearTimer(idle);
          idle = setTimer(run, idleMs());
          if (max === null) max = setTimer(run, maxMs());
        },
        flushNow: run,
        cancel() {
          pending = false;
          clear();
        },
        isPending: () => pending,
      };
    }

    // ======================================================================
    // Pure core: small Markdown dialect (safe: produces data, never HTML)
    // ======================================================================
    // Inline: `code`, **bold**, ==highlight== / =={green}highlight==, ~~strike~~,
    // *italic* / _italic_, [text](https://link "tooltip"), [text][ref] with a "[ref]: url" line anywhere,
    // ![alt](https://image), bare https:// links, <user@host> / mailto: links, H~2~O, X^2^, <kbd>Ctrl</kbd>
    // (links: http/https/mailto only; images: http/https only). An image is a click-to-load placeholder in the UI (nothing is fetched
    // until the person asks), so opening a note never contacts a remote server.
    const INLINE_RE = new RegExp(
      [
        "\\*\\*\\*([^\\s*](?:[\\s\\S]*?[^\\s*])?)\\*\\*\\*", // 1 bold + italic
        "(?<![\\w_])___([^\\s_](?:[\\s\\S]*?[^\\s_])?)___(?![\\w_])", // 2 bold + italic
        "(={4,}|==\\{\\w+\\}==)", // 3 empty highlight: kept as text
        "(?<![\\w_])__([^\\s_](?:[\\s\\S]*?[^\\s_])?)__(?![\\w_])", // 4 bold (underscores)
        "(`+)([\\s\\S]*?[^`])\\5(?!`)", // 5,6 code
        "\\*\\*(?=\\S)([\\s\\S]+?)(?<=\\S)\\*\\*", // 7 bold
        "==(?:\\{(\\w+)\\})?([\\s\\S]+?)==", // 8 color, 9 highlight
        "~~(?=\\S)([\\s\\S]+?)(?<=\\S)~~", // 10 strike
        "(?<![\\w*])\\*([^\\s*](?:[\\s\\S]*?[^\\s*])?)\\*(?![\\w*])", // 11 italic
        "(?<![\\w_])_([^\\s_](?:[\\s\\S]*?[^\\s_])?)_(?![\\w_])", // 12 italic
        "\\[((?:!\\[[^\\]\\n]*\\]\\([^\\s)]+\\)|[^\\]\\n])+)\\]\\(([^\\s)]+)(?:\\s+\\x22([^\\x22]*)\\x22)?\\)", // 13 text, 14 href, 15 "title" (tooltip)
        "<?(https?:\\/\\/[^\\s<>\"')\\]]+)>?", // 16 bare url, or <url>
        "!\\[([^\\]\\n]*)\\]\\(([^\\s)]+)(?:\\s+\\x22([^\\x22]*)\\x22)?\\)", // 17 alt, 18 src, 19 "title" (image)
        "(?<!~)~([^\\s~]+)~(?!~)", // 20 subscript  H~2~O
        "\\^([^\\s^]+)\\^", // 21 superscript  X^2^
        "<[kK][bB][dD]>([^<\\n]+)<\\/[kK][bB][dD]>", // 22 keyboard key
        "\\[([^\\]\\n]+)\\]\\[([^\\]\\n]*)\\]", // 23 text, 24 label (reference link, see REFS)
        "<(?:mailto:)?([^\\s<>@\\x22]+@[^\\s<>@\\x22]+\\.[^\\s<>@\\x22]+)>", // 25 <user@host.tld>
        "(?<![\\w/])mailto:([^\\s<>@\\x22]+@[^\\s<>@\\x22]+\\.[^\\s<>@\\x22,;)\\]]+)", // 26 bare mailto:user@host.tld
        "(?<![\\w$])\\$([^\\s$](?:[^$\\n]*?[^\\s$])?)\\$(?![\\d$\\w])", // 27 $math$ (not "$5 and $10": no space inside, no digit after)
      ].join("|"),
      "g",
    );
    // Links may be http, https or mailto; images (mail = false) only http and https.
    function safeHref(raw, mail = true) {
      try {
        const text = String(raw);
        if (mail && /^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(text)) return text;
        const u = new URL(text);
        return /^https?:$/.test(u.protocol) ? u.href : null;
      } catch (_) {
        return null;
      }
    }
    // Reference definitions ("[ref]: https://... "title"") of the document being parsed. Set by
    // parseBlocks for the duration of one parse; null outside it (references then stay text).
    let REFS = null;
    const refKey = (label) => String(label).trim().replace(/\s+/g, " ").toLowerCase();
    const REF_DEF_RE = /^ {0,3}\[([^\]\n]+)\]:\s+<?([^\s>]+)>?(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/;
    // Takes the definition lines out (blanked, so line numbers stay true) and returns them.
    function collectRefs(lines) {
      const refs = new Map();
      let fence = false;
      for (let i = 0; i < lines.length; i++) {
        if (/^```/.test(lines[i])) {
          fence = !fence;
          continue;
        }
        if (fence) continue;
        const m = REF_DEF_RE.exec(lines[i]);
        if (!m) continue;
        const key = refKey(m[1]);
        if (!refs.has(key)) refs.set(key, { href: m[2], title: m[3] ?? m[4] ?? m[5] ?? "" });
        lines[i] = "";
      }
      return refs;
    }

    // ======================================================================
    // Pure core: minimal offline math. A LaTeX subset becomes plain text plus sup / sub nodes
    // (no KaTeX, nothing is fetched). Anything it does not know stays visible as typed (\name).
    // $x^2$ inline, $$ ... $$ as a block. Unsupported: matrices, aligned, over/under braces.
    // ======================================================================
    const TEX_SYMBOLS = {};
    for (const [names, ch] of [
      ["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["delta", "δ"], ["epsilon", "ϵ"], ["varepsilon", "ε"], ["zeta", "ζ"], ["eta", "η"],
      ["theta", "θ"], ["vartheta", "ϑ"], ["iota", "ι"], ["kappa", "κ"], ["lambda", "λ"], ["mu", "μ"], ["nu", "ν"], ["xi", "ξ"], ["pi", "π"],
      ["rho", "ρ"], ["sigma", "σ"], ["tau", "τ"], ["upsilon", "υ"], ["phi", "ϕ"], ["varphi", "φ"], ["chi", "χ"], ["psi", "ψ"], ["omega", "ω"],
      ["Gamma", "Γ"], ["Delta", "Δ"], ["Theta", "Θ"], ["Lambda", "Λ"], ["Xi", "Ξ"], ["Pi", "Π"], ["Sigma", "Σ"], ["Upsilon", "Υ"], ["Phi", "Φ"],
      ["Psi", "Ψ"], ["Omega", "Ω"], ["times", "×"], ["cdot", "·"], ["pm", "±"], ["mp", "∓"], ["div", "÷"], ["leq le", "≤"], ["geq ge", "≥"],
      ["neq ne", "≠"], ["approx", "≈"], ["equiv", "≡"], ["sim", "∼"], ["propto", "∝"], ["infty", "∞"], ["partial", "∂"], ["nabla", "∇"],
      ["sum", "∑"], ["prod", "∏"], ["int", "∫"], ["oint", "∮"], ["in", "∈"], ["notin", "∉"], ["subset", "⊂"], ["subseteq", "⊆"], ["supset", "⊃"],
      ["cup", "∪"], ["cap", "∩"], ["emptyset", "∅"], ["forall", "∀"], ["exists", "∃"], ["neg lnot", "¬"], ["land wedge", "∧"], ["lor vee", "∨"],
      ["to rightarrow", "→"], ["leftarrow gets", "←"], ["Rightarrow implies", "⇒"], ["Leftarrow", "⇐"], ["leftrightarrow", "↔"],
      ["Leftrightarrow iff", "⇔"], ["mapsto", "↦"], ["ldots dots", "…"], ["cdots", "⋯"], ["circ", "∘"], ["degree", "°"], ["angle", "∠"],
      ["perp", "⊥"], ["parallel", "∥"], ["hbar", "ℏ"], ["ell", "ℓ"], ["prime", "′"], ["langle", "⟨"], ["rangle", "⟩"], ["ll", "≪"], ["gg", "≫"],
      ["star", "⋆"], ["bullet", "•"], ["oplus", "⊕"], ["otimes", "⊗"], ["therefore", "∴"], ["because", "∵"], ["quad qquad", "  "],
      [", ; : space !", " "],
      ["{ lbrace", "{"], ["} rbrace", "}"], ["% ", "%"], ["& ", "&"], ["# ", "#"], ["_ ", "_"], ["$ ", "$"], ["| ", "‖"],
    ])
      for (const name of names.split(" ")) if (name) TEX_SYMBOLS[name] = ch;
    TEX_SYMBOLS[" "] = " ";
    const TEX_WORDS = new Set("sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln lg exp lim max min sup inf det dim ker gcd deg arg mod".split(" "));
    const TEX_BLACKBOARD = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ" };
    const TEX_ACCENTS = { bar: "\u0304", overline: "\u0304", hat: "\u0302", widehat: "\u0302", tilde: "\u0303", widetilde: "\u0303", vec: "\u20d7", dot: "\u0307", ddot: "\u0308" };
    const TEX_MAX_DEPTH = 6;
    function texNodes(src) {
      src = String(src);
      if (src.length > 2000) return [{ t: "text", s: src }];
      const ctx = { s: src, i: 0 };
      const nodes = texSeq(ctx, 0, false);
      return nodes.length ? nodes : [{ t: "text", s: src }];
    }
    function texPush(out, node) {
      const last = out[out.length - 1];
      if (node.t === "text" && last && last.t === "text") last.s += node.s;
      else out.push(node);
    }
    // One argument: {group}, \command, or a single character.
    function texArg(ctx, depth) {
      const { s } = ctx;
      while (s[ctx.i] === " ") ctx.i++;
      if (ctx.i >= s.length) return [];
      if (s[ctx.i] === "{") {
        ctx.i++;
        return texSeq(ctx, depth + 1, true);
      }
      if (s[ctx.i] === "\\") return texCommand(ctx, depth);
      return [{ t: "text", s: s[ctx.i++] }];
    }
    function texFlat(nodes) {
      return nodes.map((n) => n.s ?? texFlat(n.c || [])).join("");
    }
    const texSimple = (nodes) => /^[\w.\u0370-\u03ff\u2200-\u22ff]+$/.test(texFlat(nodes));
    function texWrap(nodes) {
      return texSimple(nodes) ? nodes : [{ t: "text", s: "(" }, ...nodes, { t: "text", s: ")" }];
    }
    function texCommand(ctx, depth) {
      const { s } = ctx;
      ctx.i++; // the backslash
      let name = "";
      if (/[A-Za-z]/.test(s[ctx.i] || "")) while (/[A-Za-z]/.test(s[ctx.i] || "")) name += s[ctx.i++];
      else name = s[ctx.i++] || "";
      if (name === "\\") return [{ t: "text", s: " " }];
      if (name === "left" || name === "right" || name === "displaystyle" || name === "limits" || name === "nolimits") {
        if (name === "left" || name === "right") {
          if (s[ctx.i] === ".") ctx.i++; // \left. is an invisible delimiter
        }
        return [];
      }
      if (Object.prototype.hasOwnProperty.call(TEX_SYMBOLS, name)) return [{ t: "text", s: TEX_SYMBOLS[name] }];
      if (TEX_WORDS.has(name)) return [{ t: "text", s: name }];
      if (depth >= TEX_MAX_DEPTH) return [{ t: "text", s: "\\" + name }];
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const a = texArg(ctx, depth);
        const b = texArg(ctx, depth);
        return [...texWrap(a), { t: "text", s: "/" }, ...texWrap(b)];
      }
      if (name === "sqrt") {
        let root = null;
        if (s[ctx.i] === "[") {
          const end = s.indexOf("]", ctx.i);
          if (end > 0) {
            root = s.slice(ctx.i + 1, end);
            ctx.i = end + 1;
          }
        }
        const body = texArg(ctx, depth);
        return [...(root ? [{ t: "sup", c: [{ t: "text", s: root }] }] : []), { t: "text", s: "√" }, ...texWrap(body)];
      }
      if (name === "text" || name === "mathrm" || name === "operatorname" || name === "mathit" || name === "mbox" || name === "mathcal" || name === "mathsf" || name === "mathtt")
        return texArg(ctx, depth);
      if (name === "mathbf" || name === "boldsymbol" || name === "bm") return [{ t: "b", c: texArg(ctx, depth) }];
      if (name === "mathbb") {
        const a = texArg(ctx, depth);
        const f = texFlat(a);
        return [{ t: "text", s: f.length === 1 && TEX_BLACKBOARD[f] ? TEX_BLACKBOARD[f] : f }];
      }
      if (TEX_ACCENTS[name]) {
        const a = texArg(ctx, depth);
        const f = texFlat(a);
        return f ? [{ t: "text", s: f[0] + TEX_ACCENTS[name] + f.slice(1) }] : [];
      }
      return [{ t: "text", s: "\\" + name }]; // unknown: shown as typed
    }
    function texSeq(ctx, depth, inGroup) {
      const out = [];
      const { s } = ctx;
      while (ctx.i < s.length) {
        const ch = s[ctx.i];
        if (ch === "}" && inGroup) {
          ctx.i++;
          return out;
        }
        if (ch === "{") {
          ctx.i++;
          if (depth >= TEX_MAX_DEPTH) texPush(out, { t: "text", s: "{" });
          else for (const n of texSeq(ctx, depth + 1, true)) texPush(out, n);
        } else if (ch === "^" || ch === "_") {
          ctx.i++;
          const arg = depth >= TEX_MAX_DEPTH ? [{ t: "text", s: ch }] : texArg(ctx, depth);
          if (arg.length) out.push({ t: ch === "^" ? "sup" : "sub", c: arg });
        } else if (ch === "\\") {
          for (const n of texCommand(ctx, depth)) texPush(out, n);
        } else {
          ctx.i++;
          texPush(out, { t: "text", s: ch === "~" ? " " : ch });
        }
      }
      return out;
    }

    function parseInlineRaw(text, depth = 0) {
      text = String(text);
      if (depth > 4 || text.length > MAX_INLINE_CHARS)
        return text ? [{ t: "text", s: text }] : [];
      const out = [];
      let last = 0;
      const re = new RegExp(INLINE_RE.source, "g");
      for (let m; (m = re.exec(text)); ) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        if (m.index > last)
          out.push({ t: "text", s: text.slice(last, m.index) });
        last = m.index + m[0].length;
        if (m[1] !== undefined || m[2] !== undefined)
          out.push({ t: "b", c: [{ t: "i", c: parseInline(m[1] ?? m[2], depth + 1) }] });
        else if (m[3] !== undefined) out.push({ t: "text", s: m[3] }); // ==== and =={red}== stay literal
        else if (m[4] !== undefined) out.push({ t: "b", c: parseInline(m[4], depth + 1) });
        else if (m[5] !== undefined) out.push({ t: "code", s: m[6] });
        else if (m[7] !== undefined)
          out.push({ t: "b", c: parseInline(m[7], depth + 1) });
        else if (m[9] !== undefined)
          out.push({
            t: "hl",
            color: HIGHLIGHT_COLORS.includes(m[8]) ? m[8] : "yellow",
            c: parseInline(m[9], depth + 1),
          });
        else if (m[10] !== undefined)
          out.push({ t: "s", c: parseInline(m[10], depth + 1) });
        else if (m[11] !== undefined || m[12] !== undefined)
          out.push({ t: "i", c: parseInline(m[11] ?? m[12], depth + 1) });
        else if (m[17] !== undefined) {
          const href = safeHref(m[18], false);
          if (href) out.push({ t: "img", alt: m[17], href });
          else out.push({ t: "text", s: m[0] });
        } else if (m[13] !== undefined) {
          const href = safeHref(m[14]);
          if (href) {
            const a = { t: "a", href, c: parseInline(m[13], depth + 1) };
            if (m[15]) a.title = m[15];
            out.push(a);
          } else out.push({ t: "text", s: m[0] });
        } else if (m[20] !== undefined) out.push({ t: "sub", c: parseInline(m[20], depth + 1) });
        else if (m[21] !== undefined) out.push({ t: "sup", c: parseInline(m[21], depth + 1) });
        else if (m[22] !== undefined) out.push({ t: "kbd", s: m[22] });
        else if (m[27] !== undefined) out.push({ t: "math", c: texNodes(m[27]) });
        else if (m[23] !== undefined) {
          const def = REFS?.get(refKey(m[24] || m[23]));
          const href = def && safeHref(def.href);
          if (href) {
            const a = { t: "a", href, c: parseInline(m[23], depth + 1) };
            if (def.title) a.title = def.title;
            out.push(a);
          } else out.push({ t: "text", s: m[0] });
        } else if (m[25] !== undefined || m[26] !== undefined) {
          const addr = m[25] ?? m[26];
          out.push({ t: "a", href: "mailto:" + addr, c: [{ t: "text", s: addr }] });
        } else if (m[16] !== undefined) {
          let url = m[16];
          let trail = "";
          const tm = /[.,;:!?]+$/.exec(url);
          if (tm) {
            trail = tm[0];
            url = url.slice(0, -trail.length);
          }
          const href = safeHref(url);
          if (href) {
            out.push({ t: "a", href, c: [{ t: "text", s: url }] });
            if (trail) out.push({ t: "text", s: trail });
          } else out.push({ t: "text", s: m[0] });
        }
      }
      if (last < text.length) out.push({ t: "text", s: text.slice(last) });
      return out;
    }

    // Backslash escapes: \* \# \[ ... show the character itself. They are swapped for private-use
    // characters before parsing and swapped back in the finished text (so they cannot start markup).
    const ESC_CHARS = "\\`*_{}[]()#+-.!|=~<>^$";
    function parseInline(text, depth = 0) {
      text = String(text);
      if (depth > 0 || !text.includes("\\")) return parseInlineRaw(text, depth);
      const swapped = text.replace(/\\([\\`*_{}[\]()#+\-.!|=~<>^$])/g, (_m, ch) => String.fromCharCode(0xe000 + ESC_CHARS.indexOf(ch)));
      const back = (str, keepSlash) => str.replace(/[\ue000-\ue015]/g, (c) => (keepSlash ? "\\" : "") + ESC_CHARS[c.charCodeAt(0) - 0xe000]);
      const fix = (nodes) => {
        for (const n of nodes) {
          if (n.t === "text") n.s = back(n.s, false);
          else if (n.t === "code") n.s = back(n.s, true); // inside code a backslash is just a backslash
          else {
            if (n.href) n.href = back(n.href, true);
            if (n.alt) n.alt = back(n.alt, false);
            if (n.c) fix(n.c);
          }
        }
        return nodes;
      };
      return fix(parseInlineRaw(swapped, 0));
    }

    const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/;
    // GitHub-style tables: a header row, a delimiter row with pipes (| --- | :-: |), body rows.
    const TABLE_DELIM_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
    function splitRow(line) {
      let t = line.trim();
      if (t.startsWith("|")) t = t.slice(1);
      if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
      const cells = [];
      let cur = "";
      for (let i = 0; i < t.length; i++) {
        if (t[i] === "\\" && t[i + 1] === "|") {
          cur += "|";
          i++;
        } else if (t[i] === "|") {
          cells.push(cur.trim());
          cur = "";
        } else cur += t[i];
      }
      cells.push(cur.trim());
      return cells;
    }
    function isTableStart(lines, i) {
      if (i + 1 >= lines.length) return false;
      const head = lines[i],
        delim = lines[i + 1];
      if (!head.includes("|") || !delim.includes("|") || !TABLE_DELIM_RE.test(delim)) return false;
      return splitRow(head).length === splitRow(delim).length;
    }
    function parseTable(lines, start) {
      const head = splitRow(lines[start]).slice(0, MAX_TABLE_COLS);
      const align = splitRow(lines[start + 1])
        .slice(0, MAX_TABLE_COLS)
        .map((d) => (d.startsWith(":") && d.endsWith(":") ? "center" : d.endsWith(":") ? "right" : d.startsWith(":") ? "left" : ""));
      const rows = [];
      let i = start + 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|") && rows.length < MAX_TABLE_ROWS) {
        const cells = splitRow(lines[i]).slice(0, head.length);
        while (cells.length < head.length) cells.push("");
        rows.push(cells.map((c) => parseInline(c)));
        i++;
      }
      return { block: { type: "table", align, head: head.map((c) => parseInline(c)), rows }, next: i };
    }
    // opts.joinLines: a single newline inside a paragraph is a space (standard Markdown) instead of
    // a line break. opts.keepBlanks: every blank line after the first adds one empty gap.
    // opts.setext: text over a line of === (heading 1) or --- (heading 2) is a heading; off, a line of
    // --- is a horizontal rule and === stays text. Top-level blocks carry a non-enumerable `src`: the
    // source line they start on (used by linked scrolling; not part of the block's signature).
    function parseBlocks(text, nested = false, opts = {}) {
      if (nested) return parseBlocksIn(text, true, opts);
      const lines = normalizeNewlines(text).split("\n");
      const before = REFS;
      REFS = collectRefs(lines);
      try {
        return parseBlocksIn(lines.join("\n"), false, opts);
      } finally {
        REFS = before;
      }
    }
    // <details> ... </details> with an optional <summary>: a collapsible block. Only these two tags (and
    // <details open>) are understood; attributes are ignored and the inner text is plain Markdown.
    const DETAILS_OPEN_RE = /^\s*<details(?:\s+open)?\s*>/i;
    const DETAILS_CLOSE_RE = /<\/details\s*>/i;
    // Returns { block, next } or null (no matching close tag: the lines stay ordinary text).
    function parseDetails(lines, start, nested, opts) {
      const first = lines[start];
      const open = /^\s*<details\s+open\s*>/i.test(first);
      const rest = first.replace(DETAILS_OPEN_RE, "");
      let depth = 1;
      const inner = [];
      let end = -1;
      for (let j = start; j < lines.length && j - start < 2000; j++) {
        const raw = j === start ? rest : lines[j];
        let line = raw;
        let scan = raw;
        for (let m; (m = /<details(?:\s+open)?\s*>|<\/details\s*>/i.exec(scan)); ) {
          const closing = m[0][1] === "/";
          depth += closing ? -1 : 1;
          if (depth === 0) {
            line = raw.slice(0, raw.length - scan.length + m.index);
            end = j;
            break;
          }
          scan = scan.slice(m.index + m[0].length);
        }
        inner.push(line);
        if (end >= 0) break;
      }
      if (end < 0) return null;
      let k = 0;
      while (k < inner.length && !inner[k].trim()) k++;
      let summary = [];
      const sm = k < inner.length ? /^\s*<summary>([\s\S]*?)<\/summary>\s*/i.exec(inner[k]) : null;
      if (sm) {
        summary = parseInline(sm[1].trim());
        inner[k] = inner[k].slice(sm[0].length);
      }
      const body = parseBlocks(inner.slice(k).join("\n"), true, opts);
      return { block: { type: "details", open, summary, blocks: body }, next: end + 1 };
    }
    // $$ x^2 $$ on one line, or $$ on its own line ... $$ on its own line.
    function parseMathBlock(lines, start) {
      const one = /^\s*\$\$(.+?)\$\$\s*$/.exec(lines[start]);
      if (one) return { block: { type: "math", c: texNodes(one[1].trim()) }, next: start + 1 };
      if (!/^\s*\$\$\s*$/.test(lines[start])) return null;
      for (let j = start + 1; j < lines.length && j - start < 200; j++) {
        if (/^\s*\$\$\s*$/.test(lines[j]))
          return { block: { type: "math", c: texNodes(lines.slice(start + 1, j).join(" ").trim()) }, next: j + 1 };
      }
      return null;
    }
    const SETEXT_RE = /^\s{0,3}(=+|-+)\s*$/;
    function parseBlocksIn(text, nested, opts) {
      const lines = normalizeNewlines(text).split("\n");
      const blocks = [];
      let i = 0;
      const startsBlock = (l) =>
        /^```/.test(l) ||
        /^#{1,6}\s+\S/.test(l) ||
        /^>/.test(l) ||
        DETAILS_OPEN_RE.test(l) ||
        /^\s*\$\$/.test(l) ||
        LIST_RE.test(l) ||
        /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l);
      while (i < lines.length) {
        const line = lines[i];
        const firstNew = blocks.length;
        const startLine = i;
        let m;
        if (!line.trim()) {
          let run = 0;
          while (i < lines.length && !lines[i].trim()) {
            run++;
            i++;
          }
          if (opts.keepBlanks && run > 1 && blocks.length && i < lines.length)
            blocks.push({ type: "gap", n: run - 1 });
        } else if (DETAILS_OPEN_RE.test(line) && (m = parseDetails(lines, i, nested, opts))) {
          blocks.push(m.block);
          i = m.next;
        } else if (/^\s*\$\$/.test(line) && (m = parseMathBlock(lines, i))) {
          blocks.push(m.block);
          i = m.next;
        } else if ((m = /^```([\w+#.-]*)\s*$/.exec(line))) {
          const buf = [];
          i++;
          while (i < lines.length && !/^```\s*$/.test(lines[i]))
            buf.push(lines[i++]);
          i++; // closing fence (or end of text)
          const code = { type: "code", text: buf.join("\n") };
          if (m[1]) code.lang = m[1].toLowerCase();
          blocks.push(code);
        } else if ((m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line))) {
          blocks.push({
            type: "h",
            level: m[1].length,
            c: parseInline(m[2]),
            line: nested ? -1 : i,
          });
          i++;
        } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
          blocks.push({ type: "hr" });
          i++;
        } else if (/^>/.test(line)) {
          const buf = [];
          while (i < lines.length && /^>/.test(lines[i]))
            buf.push(lines[i++].replace(/^>\s?/, ""));
          const inner = parseBlocks(buf.join("\n"), true, opts);
          const quote = { type: "quote", blocks: inner };
          // > [!NOTE] Title  ->  a callout (note, tip, important, warning, caution, info)
          const first = inner[0]?.type === "p" ? inner[0].c[0] : null;
          const cm = first && first.t === "text" ? /^\[!(note|tip|important|warning|caution|info)\][ \t]*(.*)$/i.exec(first.s) : null;
          if (cm) {
            quote.callout = { kind: cm[1].toLowerCase(), title: cm[2].trim() };
            inner[0].c.splice(0, inner[0].c[1]?.t === "br" ? 2 : 1);
            if (!inner[0].c.length) inner.shift();
          }
          blocks.push(quote);
        } else if ((m = LIST_RE.exec(line))) {
          const items = [];
          const counters = []; // running number per nesting level, for ordered lists
          let lastIndent = 0;
          while (i < lines.length) {
            if ((m = LIST_RE.exec(lines[i]))) {
              lastIndent = m[1].replace(/\t/g, "  ").length;
              const level = Math.min(4, Math.floor(lastIndent / 2));
              counters.length = level + 1;
              let marker = "\u2022";
              if (/^\d/.test(m[2])) {
                const n = counters[level] === undefined ? parseInt(m[2], 10) : counters[level] + 1;
                counters[level] = n;
                marker = n + m[2].slice(-1);
              } else counters[level] = undefined;
              items.push({
                level,
                marker,
                checked: m[3] === undefined ? null : m[3] !== " ",
                c: parseInline(m[4]),
                line: nested ? -1 : i,
              });
              i++;
              continue;
            }
            // A blank line followed by an indented paragraph continues the previous item.
            let j = i;
            while (j < lines.length && !lines[j].trim()) j++;
            if (j === i || j >= lines.length || LIST_RE.test(lines[j])) break;
            if (lines[j].replace(/\t/g, "  ").match(/^ */)[0].length < lastIndent + 2) break;
            const para = [];
            while (j < lines.length && lines[j].trim() && !LIST_RE.test(lines[j])) para.push(lines[j++].trim());
            const last = items[items.length - 1];
            (last.more || (last.more = [])).push(
              para.flatMap((l, idx) => (idx ? [opts.joinLines ? { t: "text", s: " " } : { t: "br" }, ...parseInline(l)] : parseInline(l))),
            );
            i = j;
          }
          blocks.push({ type: "list", items });
        } else if (isTableStart(lines, i)) {
          const t = parseTable(lines, i);
          blocks.push(t.block);
          i = t.next;
        } else {
          const buf = [];
          while (
            i < lines.length &&
            lines[i].trim() &&
            !startsBlock(lines[i]) &&
            !isTableStart(lines, i) &&
            !(opts.setext && buf.length && SETEXT_RE.test(lines[i]))
          )
            buf.push(lines[i++]);
          if (!buf.length) buf.push(lines[i++]);
          const under = opts.setext && i < lines.length ? SETEXT_RE.exec(lines[i]) : null;
          if (under) {
            blocks.push({
              type: "h",
              level: under[1][0] === "=" ? 1 : 2,
              c: parseInline(buf.map((l) => l.trim()).join(" ")),
              line: nested ? -1 : startLine,
            });
            i++; // the underline
          } else {
            const c = [];
            buf.forEach((l, idx) => {
              if (idx) c.push(opts.joinLines ? { t: "text", s: " " } : { t: "br" });
              c.push(...parseInline(l));
            });
            blocks.push({ type: "p", c });
          }
        }
        if (!nested)
          for (let k = firstNew; k < blocks.length; k++) Object.defineProperty(blocks[k], "src", { value: startLine });
      }
      return blocks;
    }


    // ======================================================================
    // Pure core: syntax colors for fenced code (small, offline, a handful of languages)
    // ======================================================================
    // highlightCode(text, lang) -> [{ k, s }] where k is "" (plain), kw, lit, str, num, com, fn, prop or
    // tag. Adjacent pieces of the same kind are merged. Unknown languages, and blocks longer than
    // MAX_HIGHLIGHT_CHARS, come back as one plain piece. It only reads text; it never builds HTML.
    const words = (t) => new Set(t.split(" "));
    const C_KW = "break case continue default do else for goto if return sizeof static struct switch typedef union while const enum extern volatile void";
    const LANG_SPECS = {
      js: { kw: words("async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch throw try typeof var void while with yield as interface type enum implements public private protected readonly abstract declare namespace"), lit: words("true false null undefined NaN Infinity this"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "'", "`"], fn: true },
      py: { kw: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case"), lit: words("True False None self"), line: ["#"], quotes: ["\"", "'"], triple: true, fn: true, decorator: true },
      c: { kw: words(C_KW + " inline restrict auto register"), lit: words("true false NULL nullptr"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "'"], fn: true, preproc: true },
      cpp: { kw: words(C_KW + " class namespace template typename public private protected virtual override new delete try catch throw using auto constexpr operator this final"), lit: words("true false NULL nullptr"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "'"], fn: true, preproc: true },
      java: { kw: words("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try void volatile while var record"), lit: words("true false null"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "'"], fn: true, decorator: true },
      cs: { kw: words("abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly ref return sealed short sizeof static string struct switch this throw try typeof uint ulong unsafe ushort using var virtual void volatile while"), lit: words("true false null"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "'"], fn: true },
      go: { kw: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"), lit: words("true false nil iota"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "`", "'"], fn: true },
      rust: { kw: words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while"), lit: words("true false None Some Ok Err"), line: ["//"], block: ["/*", "*/"], quotes: ["\""], fn: true },
      sh: { kw: words("if then else elif fi for while until do done case esac in function select return exit export local readonly unset echo cd source alias"), lit: words("true false"), line: ["#"], quotes: ["\"", "'"], dollar: true, hashWord: true },
      sql: { kw: words("SELECT FROM WHERE AND OR NOT NULL INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX VIEW JOIN INNER LEFT RIGHT OUTER FULL ON AS GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT UNION ALL EXISTS IN BETWEEN LIKE IS CASE WHEN THEN ELSE END PRIMARY KEY FOREIGN REFERENCES DEFAULT UNIQUE CHECK ASC DESC COUNT SUM AVG MIN MAX"), lit: words("TRUE FALSE NULL"), line: ["--"], block: ["/*", "*/"], quotes: ["'", "\""], fold: true, fn: true },
      json: { kw: new Set(), lit: words("true false null"), line: [], quotes: ["\""], jsonKeys: true },
      css: { kw: new Set(), lit: new Set(), line: [], block: ["/*", "*/"], quotes: ["\"", "'"], css: true },
      html: { kw: new Set(), lit: new Set(), line: [], quotes: ["\"", "'"], markup: true },
    };
    const LANG_ALIAS = {
      javascript: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", typescript: "js", ts: "js", tsx: "js",
      python: "py", py: "py", c: "c", h: "c", cpp: "cpp", "c++": "cpp", cc: "cpp", hpp: "cpp",
      java: "java", csharp: "cs", "c#": "cs", cs: "cs", go: "go", golang: "go", rust: "rust", rs: "rust",
      bash: "sh", sh: "sh", shell: "sh", zsh: "sh", console: "sh", sql: "sql", json: "json", jsonc: "json",
      css: "css", html: "html", xml: "html", svg: "html", xhtml: "html",
    };
    const codeLangKey = (lang) => LANG_ALIAS[String(lang || "").toLowerCase()] || null;
    function highlightCode(text, lang) {
      text = String(text);
      const spec = LANG_SPECS[codeLangKey(lang)];
      if (!spec || text.length > MAX_HIGHLIGHT_CHARS) return text ? [{ k: "", s: text }] : [];
      const out = [];
      const push = (k, str) => {
        if (!str) return;
        const last = out[out.length - 1];
        if (last && last.k === k) last.s += str;
        else out.push({ k, s: str });
      };
      const n = text.length;
      let i = 0;
      let depth = 0; // css braces
      let inTag = false; // markup: between < and >
      const isWordStart = (c) => /[A-Za-z_$]/.test(c);
      const endOfString = (from, q) => {
        let j = from + 1;
        while (j < n) {
          if (text[j] === "\\") j += 2;
          else if (text[j] === q) return j + 1;
          else if (text[j] === "\n" && q !== "`") return j; // an unclosed string stops at the line end
          else j++;
        }
        return n;
      };
      while (i < n) {
        const c = text[i];
        // markup (html / xml)
        if (spec.markup) {
          if (text.startsWith("<!--", i)) {
            const e = text.indexOf("-->", i + 4);
            const to = e < 0 ? n : e + 3;
            push("com", text.slice(i, to));
            i = to;
            continue;
          }
          if (!inTag && c === "<" && /[A-Za-z/!?]/.test(text[i + 1] || "")) {
            const m = /^<[/!?]?[A-Za-z][\w:.-]*/.exec(text.slice(i, i + 80));
            if (m) {
              push("tag", m[0]);
              i += m[0].length;
              inTag = true;
              continue;
            }
          }
          if (inTag) {
            if (c === ">" || (c === "/" && text[i + 1] === ">")) {
              const to = c === ">" ? i + 1 : i + 2;
              push("tag", text.slice(i, to));
              i = to;
              inTag = false;
              continue;
            }
            if (c === '"' || c === "'") {
              const to = endOfString(i, c);
              push("str", text.slice(i, to));
              i = to;
              continue;
            }
            const am = /^[A-Za-z_:][\w:.-]*/.exec(text.slice(i, i + 60));
            if (am) {
              push("prop", am[0]);
              i += am[0].length;
              continue;
            }
          }
          push("", c);
          i++;
          continue;
        }
        // comments
        if (spec.block && text.startsWith(spec.block[0], i)) {
          const e = text.indexOf(spec.block[1], i + spec.block[0].length);
          const to = e < 0 ? n : e + spec.block[1].length;
          push("com", text.slice(i, to));
          i = to;
          continue;
        }
        const lc = spec.line.find((t) => text.startsWith(t, i));
        if (lc && (!spec.hashWord || i === 0 || /[\s;|&(]/.test(text[i - 1]))) {
          const e = text.indexOf("\n", i);
          const to = e < 0 ? n : e;
          push("com", text.slice(i, to));
          i = to;
          continue;
        }
        // strings
        if (spec.triple && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
          const q = text.slice(i, i + 3);
          const e = text.indexOf(q, i + 3);
          const to = e < 0 ? n : e + 3;
          push("str", text.slice(i, to));
          i = to;
          continue;
        }
        if (spec.quotes.includes(c)) {
          const to = endOfString(i, c);
          const str = text.slice(i, to);
          let kind = "str";
          if (spec.jsonKeys && /^\s*:/.test(text.slice(to, to + 40))) kind = "prop";
          push(kind, str);
          i = to;
          continue;
        }
        // css
        if (spec.css) {
          if (c === "{") depth++;
          else if (c === "}") depth = Math.max(0, depth - 1);
          const at = /^@[\w-]+/.exec(text.slice(i, i + 40));
          if (at) {
            push("kw", at[0]);
            i += at[0].length;
            continue;
          }
          const hex = /^#[0-9a-fA-F]{3,8}\b/.exec(text.slice(i, i + 12));
          if (hex && depth > 0) {
            push("num", hex[0]);
            i += hex[0].length;
            continue;
          }
          const word = /^-{0,2}[A-Za-z_][\w-]*/.exec(text.slice(i, i + 80));
          if (word && !/[\w-]/.test(text[i - 1] || "")) {
            const after = text.slice(i + word[0].length, i + word[0].length + 40);
            push(depth > 0 && /^\s*:/.test(after) ? "prop" : "", word[0]);
            i += word[0].length;
            continue;
          }
        }
        // shell variables, decorators, preprocessor lines
        if (spec.dollar && c === "$") {
          const vm = /^\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[0-9@#?*!$-])/.exec(text.slice(i, i + 80));
          if (vm) {
            push("prop", vm[0]);
            i += vm[0].length;
            continue;
          }
        }
        if (spec.decorator && c === "@" && /[A-Za-z_]/.test(text[i + 1] || "")) {
          const dm = /^@[\w.]+/.exec(text.slice(i, i + 80));
          push("fn", dm[0]);
          i += dm[0].length;
          continue;
        }
        if (spec.preproc && c === "#" && /^\s*$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i))) {
          const e = text.indexOf("\n", i);
          const to = e < 0 ? n : e;
          push("kw", text.slice(i, to));
          i = to;
          continue;
        }
        // numbers (not inside a word)
        if (/[0-9]/.test(c) && !/[\w$]/.test(text[i - 1] || "")) {
          const nm = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/.exec(text.slice(i, i + 60));
          push("num", nm[0]);
          i += nm[0].length;
          continue;
        }
        // words
        if (isWordStart(c)) {
          const wm = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 120));
          const w = wm[0];
          const key = spec.fold ? w.toUpperCase() : w;
          let kind = "";
          if (spec.kw.has(key)) kind = "kw";
          else if (spec.lit.has(key)) kind = "lit";
          else if (spec.fn && /^\s?\(/.test(text.slice(i + w.length, i + w.length + 2))) kind = "fn";
          push(kind, w);
          i += w.length;
          continue;
        }
        push("", c);
        i++;
      }
      return out;
    }

    // ======================================================================
    // Pure core: linked scrolling (map the top visible source line to the rendered block)
    // ======================================================================
    // Anchors are [{ line, y }] sorted by both fields: where a source line starts in a pane. mapPosition
    // converts a position in one pane to the other by straight-line interpolation between the two
    // anchors around it, so the same source line stays at the top of both panes whatever their line
    // heights are. `from` / `to` name the fields ("y" or "line").
    function mapPosition(anchors, value, from, to) {
      const n = anchors.length;
      if (!n) return 0;
      if (value <= anchors[0][from]) return anchors[0][to];
      if (value >= anchors[n - 1][from]) return anchors[n - 1][to];
      let lo = 0,
        hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (anchors[mid][from] <= value) lo = mid;
        else hi = mid;
      }
      const a = anchors[lo],
        b = anchors[hi];
      const span = b[from] - a[from];
      return span > 0 ? a[to] + ((value - a[from]) / span) * (b[to] - a[to]) : a[to];
    }
    // Anchors for the rendered pane: one per top-level block (or list item) with its source line and
    // the offset of its first node; `ends` closes the list at the total line count / scroll height.
    function mergeAnchors(list, endLine, endY) {
      const out = [];
      for (const a of list) {
        const last = out[out.length - 1];
        if (last && (a.line <= last.line || a.y <= last.y)) continue; // keep both fields strictly increasing
        out.push(a);
      }
      const last = out[out.length - 1];
      if (!last || (endLine > last.line && endY > last.y)) out.push({ line: endLine, y: endY });
      if (!out.length || out[0].line > 0) out.unshift({ line: 0, y: 0 });
      return out;
    }

    // ======================================================================
    // Pure core: incremental preview (which blocks need to be drawn again)
    // ======================================================================
    // A block's signature is its parsed data. Comparing signatures finds the unchanged leading and
    // trailing blocks, so typing inside one paragraph redraws only that paragraph. (Blocks that
    // carry a source line number change signature when lines are added above them, which is the
    // price of checkboxes that always toggle the right line.)
    const blockSig = (b) => JSON.stringify(b);
    function diffSigs(prev, next) {
      const max = Math.min(prev.length, next.length);
      let prefix = 0;
      while (prefix < max && prev[prefix] === next[prefix]) prefix++;
      let suffix = 0;
      while (suffix < max - prefix && prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
      return { prefix, suffix };
    }

    // ======================================================================
    // Pure core: export (HTML and plain text are built from the parsed blocks, never from raw input)
    // ======================================================================
    const EXPORT_FORMATS = Object.freeze({
      md: {
        label: "Markdown",
        ext: "md",
        loses: "Nothing in the text is lost. The note\u2019s color, pin and dates are not part of the file.",
      },
      html: {
        label: "HTML page",
        ext: "html",
        loses:
          "Highlight colors, tables, links, images, sub/superscript and keys are kept. Code blocks keep their text but lose their syntax colors. Checkboxes become read-only, images load from the web when you open the file, and the note\u2019s color, pin and dates are not included.",
      },
      txt: {
        label: "Plain text",
        ext: "txt",
        loses:
          "All formatting is dropped: bold, italic, strikethrough, highlights, sub/superscript and heading sizes disappear. Links are written as text followed by the address, images become [image: description], tables become rows separated by \" | \".",
      },
      pdf: {
        label: "PDF (print)",
        ext: "html",
        loses:
          "The note opens as a page in a tab and your browser\u2019s print dialog appears: choose \u201cSave as PDF\u201d. Page breaks are decided by the browser, images load from the web, checkboxes are read-only, and the note\u2019s color, pin and dates are not included.",
      },
      zip: {
        label: "Zip of all notes",
        ext: "zip",
        loses: "Each note becomes one .md file. Trashed notes are skipped. Note colors, pins and dates are not part of the files.",
      },
    });
    const escHtml = (t) =>
      String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    function inlineHtml(nodes) {
      let out = "";
      for (const n of nodes) {
        if (n.t === "text") out += escHtml(n.s);
        else if (n.t === "br") out += "<br>";
        else if (n.t === "math") out += '<span class="math">' + inlineHtml(n.c) + "</span>";
        else if (n.t === "code") out += "<code>" + escHtml(n.s) + "</code>";
        else if (n.t === "img") out += '<img src="' + escHtml(n.href) + '" alt="' + escHtml(n.alt) + '">';
        else if (n.t === "a") out += '<a href="' + escHtml(n.href) + '"' + (n.title ? ' title="' + escHtml(n.title) + '"' : "") + ' rel="noopener noreferrer">' + inlineHtml(n.c) + "</a>";
        else if (n.t === "kbd") out += "<kbd>" + escHtml(n.s) + "</kbd>";
        else if (n.t === "hl") out += '<mark data-color="' + escHtml(n.color) + '">' + inlineHtml(n.c) + "</mark>";
        else {
          const tag = { b: "strong", i: "em", s: "del", sub: "sub", sup: "sup" }[n.t];
          if (tag) out += "<" + tag + ">" + inlineHtml(n.c) + "</" + tag + ">";
        }
      }
      return out;
    }
    function listHtml(items) {
      let out = "";
      const stack = [];
      for (const it of items) {
        const tag = /^\d/.test(it.marker) ? "ol" : "ul";
        while (stack.length && stack[stack.length - 1].level > it.level) out += "</li></" + stack.pop().tag + ">";
        const top = stack[stack.length - 1];
        if (top && top.level === it.level && top.tag === tag) out += "</li>";
        else {
          if (top && top.level === it.level) out += "</li></" + stack.pop().tag + ">";
          out += "<" + tag + ">";
          stack.push({ tag, level: it.level });
        }
        out +=
          "<li>" +
          (it.checked === null ? "" : '<input type="checkbox" disabled' + (it.checked ? " checked" : "") + "> ") +
          inlineHtml(it.c) +
          (it.more || []).map((para) => "<p>" + inlineHtml(para) + "</p>").join("");
      }
      while (stack.length) out += "</li></" + stack.pop().tag + ">";
      return out;
    }
    function blocksHtml(blocks) {
      let out = "";
      for (const b of blocks) {
        if (b.type === "h") out += "<h" + b.level + ">" + inlineHtml(b.c) + "</h" + b.level + ">\n";
        else if (b.type === "p") out += "<p>" + inlineHtml(b.c) + "</p>\n";
        else if (b.type === "hr") out += "<hr>\n";
        else if (b.type === "math") out += '<p class="math-block">' + inlineHtml(b.c) + "</p>\n";
        else if (b.type === "details")
          out += "<details" + (b.open ? " open" : "") + ">\n" + (b.summary.length ? "<summary>" + inlineHtml(b.summary) + "</summary>\n" : "") + blocksHtml(b.blocks) + "</details>\n";
        else if (b.type === "code") out += "<pre><code>" + escHtml(b.text) + "</code></pre>\n";
        else if (b.type === "quote")
          out +=
            "<blockquote" + (b.callout ? ' class="callout" data-kind="' + b.callout.kind + '"' : "") + ">\n" +
            (b.callout ? "<p><strong>" + escHtml(b.callout.title || b.callout.kind[0].toUpperCase() + b.callout.kind.slice(1)) + "</strong></p>\n" : "") +
            blocksHtml(b.blocks) + "</blockquote>\n";
        else if (b.type === "list") out += listHtml(b.items) + "\n";
        else if (b.type === "table") {
          const cell = (tag, c, i) =>
            "<" + tag + (b.align[i] ? ' style="text-align:' + b.align[i] + '"' : "") + ">" + inlineHtml(c) + "</" + tag + ">";
          out +=
            "<table>\n<thead><tr>" + b.head.map((c, i) => cell("th", c, i)).join("") + "</tr></thead>\n<tbody>\n" +
            b.rows.map((r) => "<tr>" + r.map((c, i) => cell("td", c, i)).join("") + "</tr>\n").join("") +
            "</tbody>\n</table>\n";
        }
      }
      return out;
    }
    const EXPORT_CSS =
      ":root{color-scheme:light dark}body{max-width:46rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif}" +
      "pre{overflow:auto;padding:.6em .8em;background:rgba(127,127,127,.15);border-radius:6px}code,kbd{font-family:ui-monospace,monospace}" +
      "kbd{padding:0 .35em;border:1px solid rgba(127,127,127,.6);border-radius:4px;font-size:.9em}" +
      "blockquote{margin:.6em 0;padding-left:1em;border-left:3px solid rgba(127,127,127,.5)}.math,.math-block{font-family:Cambria Math,STIX Two Math,serif}.math-block{text-align:center;font-size:1.1em}table{border-collapse:collapse}" +
      "th,td{border:1px solid rgba(127,127,127,.5);padding:.3em .6em}img{max-width:100%}" +
      'mark{background:#fff176;color:#000}mark[data-color=green]{background:#a5d6a7}mark[data-color=blue]{background:#90caf9}' +
      'mark[data-color=pink]{background:#f8bbd0}mark[data-color=orange]{background:#ffcc80}mark[data-color=purple]{background:#ce93d8}' +
      'mark[data-color=red]{background:#ef9a9a}mark[data-color=teal]{background:#80cbc4}@media print{body{margin:0;max-width:none}}';
    function exportHtml(body, opts = {}, { print = false } = {}) {
      const title = titleOf(body) || "Note";
      return (
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>' + escHtml(title) + "</title><style>" + EXPORT_CSS + "</style></head><body>\n" +
        blocksHtml(parseBlocks(body, false, opts)) +
        (print ? "<script>addEventListener('load',function(){setTimeout(function(){print()},300)})</script>\n" : "") +
        "</body></html>\n"
      );
    }
    function inlineText(nodes) {
      let out = "";
      for (const n of nodes) {
        if (n.t === "text" || n.t === "code" || n.t === "kbd") out += n.s;
        else if (n.t === "br") out += "\n";
        else if (n.t === "img") out += n.alt ? "[image: " + n.alt + "]" : "[image]";
        else if (n.t === "a") {
          const label = inlineText(n.c);
          out += label.replace(/\/$/, "") === n.href.replace(/\/$/, "") ? label : label + " (" + n.href + ")";
        } else out += inlineText(n.c || []);
      }
      return out;
    }
    function blocksText(blocks) {
      const parts = [];
      for (const b of blocks) {
        if (b.type === "h" || b.type === "p") parts.push(inlineText(b.c));
        else if (b.type === "hr") parts.push("----------");
        else if (b.type === "math") parts.push(inlineText(b.c));
        else if (b.type === "details") parts.push((b.summary.length ? inlineText(b.summary) + "\n\n" : "") + blocksText(b.blocks));
        else if (b.type === "code") parts.push(b.text.replace(/^/gm, "    "));
        else if (b.type === "quote")
          parts.push(((b.callout ? (b.callout.title || b.callout.kind.toUpperCase()) + "\n\n" : "") + blocksText(b.blocks)).replace(/^/gm, "> "));
        else if (b.type === "list")
          parts.push(
            b.items
              .map((it) => "  ".repeat(it.level) + (it.checked === null ? (it.marker === "\u2022" ? "-" : it.marker) : it.checked ? "[x]" : "[ ]") + " " + inlineText(it.c) + (it.more || []).map((para) => "\n\n" + "  ".repeat(it.level + 1) + inlineText(para)).join(""))
              .join("\n"),
          );
        else if (b.type === "table")
          parts.push([b.head, ...b.rows].map((r) => r.map(inlineText).join(" | ")).join("\n"));
      }
      return parts.join("\n\n");
    }
    const exportText = (body, opts = {}) => blocksText(parseBlocks(body, false, opts)) + "\n";
    // One file name per note, never two the same (case-insensitive), for folder and zip export.
    function uniqueFileNames(notes, ext = "md") {
      const used = new Set();
      return notes.map((n) => {
        const base = safeFileName(titleOf(n.body), "note");
        let name = base,
          i = 2;
        while (used.has(name.toLowerCase())) name = base + " " + i++;
        used.add(name.toLowerCase());
        return name + "." + ext;
      });
    }

    // ======================================================================
    // Pure core: editing helpers (return an edit; the caller applies it)
    // ======================================================================
    function wrapSelection(value, s, e, open, close = open) {
      const sel = value.slice(s, e);
      if (
        sel.length >= open.length + close.length &&
        sel.startsWith(open) &&
        sel.endsWith(close)
      ) {
        const inner = sel.slice(open.length, sel.length - close.length);
        return {
          start: s,
          end: e,
          text: inner,
          selStart: s,
          selEnd: s + inner.length,
        };
      }
      if (
        s >= open.length &&
        value.slice(s - open.length, s) === open &&
        value.slice(e, e + close.length) === close
      ) {
        const a = s - open.length;
        return {
          start: a,
          end: e + close.length,
          text: sel,
          selStart: a,
          selEnd: a + sel.length,
        };
      }
      if (s === e)
        return {
          start: s,
          end: e,
          text: open + close,
          selStart: s + open.length,
          selEnd: s + open.length,
        };
      return {
        start: s,
        end: e,
        text: open + sel + close,
        selStart: s + open.length,
        selEnd: s + open.length + sel.length,
      };
    }

    const LINE_KINDS = {
      bullet: { test: /^\s*[-*+]\s+(?!\[[ xX]\])/, add: "- " },
      check: { test: /^\s*[-*+]\s+\[[ xX]\]\s/, add: "- [ ] " },
      heading: { test: /^#{1,6}\s/, add: "## " },
      quote: { test: /^>\s?/, add: "> " },
      ordered: { test: /^\s*\d+[.)]\s+/, add: (n) => n + ". " },
    };
    const STRIP_PREFIX =
      /^(\s*)(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s?)/;
    function toggleLinePrefix(value, s, e, kind) {
      const def = LINE_KINDS[kind];
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e);
      if (le === -1) le = value.length;
      if (e > s && value[e - 1] === "\n") le = e - 1;
      if (le < ls) le = ls;
      const lines = value.slice(ls, le).split("\n");
      const all = lines.every((l) => !l.trim() || def.test.test(l));
      let count = 0;
      const out = lines
        .map((l) => {
          if (!l.trim()) return l;
          const stripped = l.replace(STRIP_PREFIX, "$1");
          if (all) return stripped;
          count++;
          const add = typeof def.add === "function" ? def.add(count) : def.add;
          return stripped.replace(/^(\s*)/, "$1" + add);
        })
        .join("\n");
      return { start: ls, end: le, text: out, selStart: ls, selEnd: ls + out.length };
    }

    // Nest deeper (dir 1) or back out (dir -1): one more "> " on quote lines, two spaces on others.
    function nestLines(value, s, e, dir) {
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e);
      if (le === -1) le = value.length;
      if (e > s && value[e - 1] === "\n") le = e - 1;
      if (le < ls) le = ls;
      const out = value
        .slice(ls, le)
        .split("\n")
        .map((l) => {
          if (!l.trim()) return l;
          if (/^\s{0,3}>/.test(l)) return dir > 0 ? l.replace(/^(\s{0,3}(?:>\s?)+)/, "$1> ") : l.replace(/^(\s{0,3}(?:>\s?)*)>\s?/, "$1");
          return dir > 0 ? "  " + l : l.replace(/^(?: {1,2}|\t)/, "");
        })
        .join("\n");
      return { start: ls, end: le, text: out, selStart: ls, selEnd: ls + out.length };
    }

    // Horizontal rule on its own line, set off by blank lines. On an empty line it just fills it.
    function insertRule(value, s, e) {
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e);
      if (le === -1) le = value.length;
      if (!value.slice(ls, le).trim()) {
        const text = "---\n";
        return { start: ls, end: le, text, selStart: ls + text.length, selEnd: ls + text.length };
      }
      const text = "\n\n---\n\n";
      return { start: le, end: le, text, selStart: le + text.length, selEnd: le + text.length };
    }

    function continueList(value, caret) {
      const ls = value.lastIndexOf("\n", caret - 1) + 1;
      let le = value.indexOf("\n", caret);
      if (le === -1) le = value.length;
      const before = value.slice(ls, caret);
      const after = value.slice(caret, le);
      const m = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/.exec(before);
      if (!m) return null;
      const rest = before.slice(m[0].length);
      if (!rest.trim() && !after.trim())
        return { start: ls, end: caret, text: "", selStart: ls, selEnd: ls };
      let marker = m[2] ? m[2] + " " : Number(m[3]) + 1 + m[4] + " ";
      if (m[5]) marker += "[ ] ";
      const text = "\n" + m[1] + marker;
      return {
        start: caret,
        end: caret,
        text,
        selStart: caret + text.length,
        selEnd: caret + text.length,
      };
    }

    function toggleCheckboxLine(body, lineIndex) {
      const lines = normalizeNewlines(body).split("\n");
      if (lineIndex < 0 || lineIndex >= lines.length) return body;
      lines[lineIndex] = lines[lineIndex].replace(/\[([ xX])\]/, (_m, c) =>
        c === " " ? "[x]" : "[ ]",
      );
      return lines.join("\n");
    }

    // ---- insert helpers: code, links, images, tables ----------------------------------------------
    // Fenced code block on its own lines. A selection that already is a fenced block is unwrapped.
    function insertCodeBlock(value, s, e, lang = "") {
      const sel = value.slice(s, e);
      const fenced = /^```[\w+#.-]*\n([\s\S]*?)\n?```$/.exec(sel);
      if (fenced) return { start: s, end: e, text: fenced[1], selStart: s, selEnd: s + fenced[1].length };
      const lead = s > 0 && value[s - 1] !== "\n" ? "\n" : "";
      const trail = e < value.length && value[e] !== "\n" ? "\n" : "";
      const open = "```" + lang + "\n";
      const text = lead + open + sel + "\n```" + trail;
      const inner = s + lead.length + open.length;
      return { start: s, end: e, text, selStart: inner, selEnd: inner + sel.length };
    }
    // [text](address): "]" in the text and spaces or brackets in the address are escaped so the link
    // always parses back to what was typed.
    function buildLink(text, url) {
      const label = String(text).replace(/\\?\]/g, "\\]").replace(/\n+/g, " ");
      const href = String(url).trim().replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
      return "[" + label + "](" + href + ")";
    }
    function insertLink(value, s, e, text, url) {
      const md = buildLink(text, url);
      return { start: s, end: e, text: md, selStart: s + md.length, selEnd: s + md.length };
    }
    // Pasted text that is one web or mail address (nothing else) -> the safe address, or null.
    function pastedLink(raw) {
      const t = String(raw ?? "").trim();
      if (!t || /\s/.test(t) || t.length > 2000) return null;
      return /^mailto:/i.test(t) || /^https?:\/\//i.test(t) ? safeHref(t) && t : null;
    }
    // A "copy link to highlight" address (#:~:text=start,end) names the quoted words: they make a good label.
    function fragmentLabel(url) {
      const m = /#:~:text=([^&]+)/.exec(String(url));
      if (!m) return "";
      try {
        const parts = m[1].split(",").map((x) => decodeURIComponent(x.replace(/^[-]|[-]$/g, "")));
        const label = parts.length > 1 ? parts[0] + "\u2026" + parts[parts.length - 1] : parts[0];
        return label.length > 80 ? label.slice(0, 79) + "\u2026" : label;
      } catch (_) {
        return "";
      }
    }
    function insertImage(value, s, e) {
      const alt = value.slice(s, e).replace(/[\[\]\n]/g, " ").trim();
      const text = "![" + alt + "](https://)";
      const from = s + 2 + alt.length + 2;
      return { start: s, end: e, text, selStart: from, selEnd: from + 8 };
    }
    const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || lo));
    // rows counts every row including the header.
    // aligns[i] is "left", "center", "right" or "" (default) for column i.
    const alignDelim = (a) => (a === "left" ? ":---" : a === "center" ? ":---:" : a === "right" ? "---:" : "---");
    function makeTable(rows, cols, aligns = []) {
      rows = clampInt(rows, 2, MAX_TABLE_ROWS);
      cols = clampInt(cols, 1, MAX_TABLE_COLS);
      const row = (cell) => "| " + Array.from({ length: cols }, (_, i) => cell(i)).join(" | ") + " |";
      return [row((i) => "Column " + (i + 1)), row((i) => alignDelim(aligns[i])), ...Array.from({ length: rows - 1 }, () => row(() => " "))].join("\n");
    }
    function insertTable(value, s, e, rows, cols, aligns = []) {
      const table = makeTable(rows, cols, aligns);
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e);
      if (le === -1) le = value.length;
      const empty = !value.slice(ls, le).trim();
      const start = empty ? ls : le;
      const end = empty ? le : le;
      const lead = empty ? "" : "\n\n";
      const text = lead + table + "\n";
      const first = start + lead.length + 2;
      return { start, end, text, selStart: first, selEnd: first + "Column 1".length };
    }
    // Picture with an optional link around it: ![alt](src) or [![alt](src)](link). Spaces and brackets
    // in the addresses are escaped so the line parses back to what was typed.
    const escAddr = (u) => String(u).trim().replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
    function buildImage(alt, src, link = "") {
      const img = "![" + String(alt).replace(/[\[\]\n]/g, " ").trim() + "](" + escAddr(src) + ")";
      return link && safeHref(String(link).trim()) ? "[" + img + "](" + escAddr(link) + ")" : img;
    }
    function insertImageMd(value, s, e, alt, src, link = "") {
      const md = buildImage(alt, src, link);
      return { start: s, end: e, text: md, selStart: s + md.length, selEnd: s + md.length };
    }
    // Text that is one web address (http or https only: the preview loads nothing else) or null.
    const pastedWebAddress = (raw) => (/^https?:\/\//i.test(String(raw ?? "").trim()) ? pastedLink(raw) : null);
    // Languages the code highlighter knows: [fence word, label]. "" = plain text, no highlighting.
    const CODE_LANGS = Object.freeze([
      ["", "Plain text (no highlighting)"], ["js", "JavaScript / TypeScript"], ["py", "Python"], ["c", "C"], ["cpp", "C++"],
      ["java", "Java"], ["cs", "C#"], ["go", "Go"], ["rust", "Rust"], ["sh", "Shell / Bash"], ["sql", "SQL"],
      ["json", "JSON"], ["css", "CSS"], ["html", "HTML / XML"],
    ]);
    // Callouts (> [!NOTE]): kind -> label. The selected lines (or the current line) become the body;
    // on a block that already starts with a callout line only the kind changes.
    const CALLOUT_KINDS = Object.freeze([
      ["note", "Note"], ["tip", "Tip"], ["important", "Important"], ["warning", "Warning"], ["caution", "Caution"], ["info", "Info"],
    ]);
    const calloutId = (kind) => "callout" + kind[0].toUpperCase() + kind.slice(1);
    function insertCallout(value, s, e, kind) {
      kind = CALLOUT_KINDS.some((k) => k[0] === kind) ? kind : "note";
      const head = "> [!" + kind.toUpperCase() + "]";
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e > s ? e - 1 : e);
      if (le === -1) le = value.length;
      const lines = value.slice(ls, le).split("\n");
      let text;
      const already = /^>\s*\[!(?:note|tip|important|warning|caution|info)\]/i.exec(lines[0]);
      if (already) {
        lines[0] = head + lines[0].slice(already[0].length);
        text = lines.join("\n");
      } else if (!lines.join("").trim()) text = head + "\n> ";
      else text = head + "\n" + lines.map((l) => (l.trim() ? "> " + l : ">")).join("\n");
      return { start: ls, end: le, text, selStart: ls + text.length, selEnd: ls + text.length };
    }

    // ======================================================================
    // Pure core: shortcuts (one engine for every in-sheet action; the person can reassign any of them)
    // ======================================================================
    // An action with an empty `def` has no shortcut until the person assigns one. Every shortcut needs
    // Ctrl, Alt or Cmd, so typing is never hijacked. Overrides live in one preference, a JSON object
    // { actionId: "Ctrl+Shift+K" } where "" means "unassigned".
    const SHORTCUT_ACTIONS = Object.freeze([
      { id: "bold", label: "Bold", def: "Ctrl+B", edit: true },
      { id: "italic", label: "Italic", def: "Ctrl+I", edit: true },
      { id: "strike", label: "Strikethrough", def: "Ctrl+Shift+X", edit: true },
      { id: "highlight", label: "Highlight selection", def: "Ctrl+Shift+H", edit: true },
      { id: "code", label: "Inline code", def: "Ctrl+Shift+C", edit: true },
      { id: "codeBlock", label: "Code block", def: "Ctrl+Shift+M", edit: true },
      { id: "link", label: "Link\u2026", def: "Ctrl+Shift+K", edit: true },
      { id: "image", label: "Image", def: "Ctrl+Shift+G", edit: true },
      { id: "heading", label: "Heading", def: "Ctrl+Shift+1", edit: true },
      { id: "bullet", label: "Bulleted list", def: "Ctrl+Shift+8", edit: true },
      { id: "numbered", label: "Numbered list", def: "Ctrl+Shift+7", edit: true },
      { id: "check", label: "Checklist", def: "Ctrl+Shift+L", edit: true },
      { id: "quote", label: "Quote", def: "Ctrl+Shift+9", edit: true },
      { id: "table", label: "Table\u2026", def: "Ctrl+Shift+Y", edit: true },
      { id: "rule", label: "Horizontal rule", def: "", edit: true },
      { id: "indent", label: "Nest in", def: "", edit: true },
      { id: "outdent", label: "Nest out", def: "", edit: true },
      { id: "sup", label: "Superscript", def: "", edit: true },
      { id: "sub", label: "Subscript", def: "", edit: true },
      { id: "kbd", label: "Keyboard key", def: "", edit: true },
      { id: "calloutNote", label: "Callout: note", def: "Ctrl+Shift+2", edit: true },
      { id: "calloutWarning", label: "Callout: warning", def: "Ctrl+Shift+3", edit: true },
      { id: "calloutTip", label: "Callout: tip", def: "", edit: true },
      { id: "calloutImportant", label: "Callout: important", def: "", edit: true },
      { id: "calloutCaution", label: "Callout: caution", def: "", edit: true },
      { id: "calloutInfo", label: "Callout: info", def: "", edit: true },
      { id: "newNote", label: "New note", def: "Ctrl+N" },
      { id: "list", label: "All notes and search", def: "Ctrl+K" },
      { id: "mode", label: "Read / edit", def: "Ctrl+E" },
      { id: "split", label: "Split view", def: "" },
      { id: "settings", label: "Quick settings", def: "Ctrl+," },
      { id: "recent", label: "Recent notes", def: "" },
      { id: "notePin", label: "Pin note to the top of the list", def: "" },
      { id: "keepOpen", label: "Keep open / close on outside click", def: "" },
      { id: "larger", label: "Larger / smaller", def: "" },
      { id: "span", label: "Fill the whole area (both panels in Triple View)", def: "" },
      { id: "resetGeo", label: "Reset position and size", def: "" },
      // Global actions work anywhere in the window, also while Notes is closed.
      { id: "quickNew", label: "New note from anywhere", def: "", global: true },
      { id: "openFloating", label: "Open or close the standalone Notes card", def: "", global: true },
    ]);
    const SHORTCUT_IDS = new Set(SHORTCUT_ACTIONS.map((a) => a.id));
    // Toolbar buttons and editor actions the person may hide (a hidden action has no button, no menu
    // entry and no shortcut). Quick settings is never hideable, so the way back always stays.
    const HIDEABLE_TOOLS = Object.freeze([
      ["bold", "Bold"], ["italic", "Italic"], ["strike", "Strikethrough"], ["highlight", "Highlight"], ["heading", "Heading"],
      ["bullet", "Bulleted list"], ["numbered", "Numbered list"], ["check", "Checklist"], ["quote", "Quote"],
      ["outdent", "Nest out"], ["indent", "Nest in"], ["rule", "Horizontal rule"], ["code", "Inline code"],
      ["codeBlock", "Code block"], ["link", "Link"], ["image", "Image"], ["table", "Table"],
      ...CALLOUT_KINDS.map(([k, label]) => [calloutId(k), "Callout: " + label.toLowerCase()]),
      ["sup", "Superscript"], ["sub", "Subscript"], ["kbd", "Keyboard key"],
    ]);
    const HIDEABLE_IDS = new Set(HIDEABLE_TOOLS.map((t) => t[0]));
    // Preference text "bold,sup" -> Set of valid ids (unknown words are ignored).
    const parseHidden = (raw) => new Set(String(raw ?? "").split(/[\s,;]+/).filter((x) => HIDEABLE_IDS.has(x)));
    const serializeHidden = (set) => HIDEABLE_TOOLS.map((t) => t[0]).filter((id) => set.has(id)).join(",");
    const GEO_KEYS = Object.freeze(["panel", "float", "dock"]); // hosts that remember a position and size
    function formatCombo(spec) {
      if (!spec || !spec.key) return "";
      const k = spec.key;
      const name = k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1);
      return [spec.ctrl && "Ctrl", spec.alt && "Alt", spec.shift && "Shift", spec.meta && "Meta", name].filter(Boolean).join("+");
    }
    const normalizeCombo = (text) => formatCombo(parseShortcut(text));
    // The combination a key press stands for, as the same canonical text ("" for a lone modifier).
    function comboFromEvent(e) {
      const raw = String(e.key || "");
      if (!raw || ["Control", "Shift", "Alt", "Meta", "AltGraph", "OS", "Dead"].includes(raw)) return "";
      let key = raw.length === 1 ? raw.toLowerCase() : raw;
      const code = String(e.code || "");
      if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase(); // same key on every layout
      else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
      if (key === " " || key === "Spacebar") key = "Space";
      return formatCombo({ ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey, meta: !!e.metaKey, key: key.toLowerCase() });
    }
    // The stored overrides, cleaned: unknown actions and combinations without a modifier are dropped.
    function parseShortcutMap(raw) {
      let obj = null;
      try {
        obj = JSON.parse(String(raw || ""));
      } catch (_) {}
      const out = {};
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
      for (const [id, v] of Object.entries(obj)) {
        if (!SHORTCUT_IDS.has(id) || typeof v !== "string") continue;
        if (v === "") out[id] = "";
        else {
          const c = normalizeCombo(v);
          if (c) out[id] = c;
        }
      }
      return out;
    }
    // [{ id, combo, spec }] for every action that has a shortcut after the overrides are applied.
    function effectiveShortcuts(overrides = {}) {
      const list = [];
      for (const a of SHORTCUT_ACTIONS) {
        const combo = Object.prototype.hasOwnProperty.call(overrides, a.id) ? overrides[a.id] : a.def;
        const spec = combo ? parseShortcut(combo) : null;
        if (spec) list.push({ id: a.id, combo: formatCombo(spec), spec });
      }
      return list;
    }
    const findShortcutConflict = (list, id, combo) => list.find((x) => x.id !== id && x.combo === combo)?.id || "";
    const matchShortcutAction = (e, list) => list.find((x) => matchesShortcut(e, x.spec))?.id || "";
    // What a new assignment does to the stored overrides (a value equal to the default is not stored).
    function assignShortcut(overrides, id, combo) {
      const next = { ...overrides };
      const def = SHORTCUT_ACTIONS.find((a) => a.id === id)?.def ?? "";
      if (combo === def) delete next[id];
      else next[id] = combo;
      return next;
    }

    // ======================================================================
    // Pure core: quick settings (the options a person changes while writing)
    // ======================================================================
    // Themes of the card (Appearance): "zentral" follows the Zen look, "recommended" copies the RSS card
    // (popup colours, solid surface, soft shadow), the rest are fixed palettes.
    const NOTE_THEMES = Object.freeze([
      ["zentral", "Zentral"],
      ["recommended", "Recommended"],
      ["light", "Light"],
      ["dark", "Dark"],
      ["paper", "Paper"],
    ]);
    const normalizeTheme = (v) => (NOTE_THEMES.some(([k]) => k === v) ? v : "zentral");
    const QUICK_OPTIONS = Object.freeze([
      { id: "font", label: "Text size", pref: PREF.FONT_SIZE, kind: "step", min: 8, max: 40, step: 1, unit: "px", def: 13 },
      { id: "lineHeight", label: "Line height", pref: PREF.LINE_HEIGHT, kind: "step", min: 100, max: 300, step: 10, unit: "%", def: 160 },
      { id: "wrap", label: "Wrap long lines", pref: PREF.WRAP, kind: "bool", def: true },
      { id: "blank", label: "Blank lines in read view", pref: PREF.BLANK_LINES, kind: "choice", def: "collapse", choices: [["collapse", "Collapse"], ["keep", "Keep"]] },
      { id: "breaks", label: "Single line breaks", pref: PREF.LINE_BREAKS, kind: "choice", def: "break", choices: [["break", "Break"], ["join", "Join"]] },
      { id: "sync", label: "Linked scrolling in split view", meta: "syncScroll", kind: "bool", def: true },
      { id: "copy", label: "Select and copy text in read view", pref: PREF.READ_COPY, kind: "bool", def: false },
      { id: "paste", label: "Pasting a web address", pref: PREF.PASTE_LINK, kind: "choice", def: "ask", choices: [["ask", "Ask"], ["selection", "Over selection"], ["off", "As text"]] },
      { id: "setext", label: "Text over === or --- is a heading", pref: PREF.SETEXT, kind: "bool", def: false },
      { id: "theme", label: "Theme", pref: PREF.THEME, kind: "choice", def: "zentral", choices: NOTE_THEMES.map(([k, t]) => [k, t]) },
      { id: "hover", label: "Tuck away on an outside click, reveal on the top edge", pref: PREF.HOVER_REVEAL, kind: "bool", def: false },
      { id: "push", label: "Push the page aside (standalone card)", pref: PREF.PUSH_PAGE, kind: "bool", def: false },
      { id: "splitwin", label: "Split view as a second window", pref: PREF.SPLIT_WINDOW, kind: "bool", def: false },
    ]);
    const stepOption = (opt, current, dir) => clampInt((Number(current) || opt.def) + dir * opt.step, opt.min, opt.max);

    // ======================================================================
    // Pure core: window geometry (drag, resize, stay inside the area), hold-to-act, recent list
    // ======================================================================
    // Rectangles are {x, y, w, h} in pixels, local to an area {w, h} (the page area of a panel, or the
    // window for the standalone card). Nothing here touches the DOM, so every rule is unit-tested.
    const GEO_MIN = Object.freeze({ w: 240, h: 160 });
    const RESIZE_HANDLES = Object.freeze(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);
    const isNum = (v) => typeof v === "number" && Number.isFinite(v);
    // A stored rectangle, cleaned: whole pixels and a sane size, otherwise null (= use the default place).
    function normalizeGeo(raw) {
      if (!raw || typeof raw !== "object") return null;
      const { x, y, w, h } = raw;
      if (![x, y, w, h].every(isNum)) return null;
      if (w < GEO_MIN.w || h < GEO_MIN.h || w > 20000 || h > 20000 || Math.abs(x) > 40000 || Math.abs(y) > 40000) return null;
      return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    }
    // Pull a rectangle back inside the area. It keeps the minimum size unless the area itself is smaller.
    function clampGeo(rect, area, min = GEO_MIN) {
      const aw = Math.max(1, area.w), ah = Math.max(1, area.h);
      const w = Math.min(Math.max(rect.w, Math.min(min.w, aw)), aw);
      const h = Math.min(Math.max(rect.h, Math.min(min.h, ah)), ah);
      return {
        x: Math.round(Math.min(Math.max(rect.x, 0), aw - w)),
        y: Math.round(Math.min(Math.max(rect.y, 0), ah - h)),
        w: Math.round(w),
        h: Math.round(h),
      };
    }
    const moveGeo = (start, dx, dy, area) => clampGeo({ ...start, x: start.x + dx, y: start.y + dy }, area);
    // Drag one edge or corner: a west / north edge moves the origin, the opposite edge stays where it is.
    function resizeGeo(start, handle, dx, dy, area, min = GEO_MIN) {
      let left = start.x, top = start.y, right = start.x + start.w, bottom = start.y + start.h;
      const has = (c) => String(handle).includes(c);
      if (has("w")) left = Math.min(Math.max(left + dx, 0), right - min.w);
      if (has("e")) right = Math.max(Math.min(right + dx, area.w), left + min.w);
      if (has("n")) top = Math.min(Math.max(top + dy, 0), bottom - min.h);
      if (has("s")) bottom = Math.max(Math.min(bottom + dy, area.h), top + min.h);
      return clampGeo({ x: left, y: top, w: right - left, h: bottom - top }, area, min);
    }
    // Where the sheet goes inside `area` ({width, height, anchor}); the result is local to the area.
    // size: "peek" (a part of the area), "full" (all of it), "span" (all of the widest area, see the adapters).
    // A stored `geo` replaces only the peek size.
    function placeSheet({ area, size = "peek", geo = null, margin = 6 }) {
      const m = margin, aw = area.width, ah = area.height;
      const full = size === "full" || size === "span" || ah < 320;
      if (geo && !full) return clampGeo(geo, { w: aw, h: ah });
      const w = Math.max(200, aw - m * 2);
      const hgt = full ? Math.max(120, ah - m * 2) : Math.min(ah - m * 2, Math.max(280, Math.round(ah * 0.62)));
      return { x: m, y: area.anchor === "bottom" ? ah - m - hgt : m, w, h: hgt };
    }
    // How far the page must move aside for a card at [left, left+width] so it does not cover the page.
    // `content` is the page's un-pushed rectangle. Null = do not push (card wider than 60% of the page,
    // or it does not touch either edge of the page).
    function pushAmount({ left, width }, content, gap = 8) {
      const cw = content.right - content.left;
      if (!(width > 0) || !(cw > 0) || width > cw * 0.6) return null;
      const center = left + width / 2;
      if (center > (content.left + content.right) / 2) {
        const px = Math.round(content.right - left + gap);
        return px > 0 && px <= cw * 0.7 ? { side: "right", px } : null;
      }
      const px = Math.round(left + width - content.left + gap);
      return px > 0 && px <= cw * 0.7 ? { side: "left", px } : null;
    }
    // The second window of a split view: the same size as `rect`, beside it on the side with room
    // (right first), inside `bounds`. When it does not fit at full width it shrinks; below the
    // minimum width there is no place for it (null) rather than covering the first window.
    function companionRect(rect, bounds, gap = 8) {
      const right = bounds.x + bounds.w - (rect.x + rect.w) - gap;
      const left = rect.x - bounds.x - gap;
      const side = right >= rect.w ? "right" : left >= rect.w ? "left" : right >= left ? "right" : "left";
      const w = Math.min(rect.w, Math.floor(side === "right" ? right : left));
      if (!(w >= GEO_MIN.w)) return null;
      return { x: side === "right" ? rect.x + rect.w + gap : rect.x - gap - w, y: rect.y, w, h: rect.h };
    }
    // The part of `bounds` left when tall strips at its left or right edge (the native sidebar) are taken
    // out. Short or small rectangles are ignored; at least `minWidth` always remains.
    function keepClear(bounds, rects, viewHeight, minWidth = 240) {
      let left = bounds.left, right = bounds.left + bounds.width;
      const mid = bounds.left + bounds.width / 2;
      for (const r of rects || []) {
        if (!r || !(r.width >= 20) || !(r.height >= viewHeight * 0.4)) continue;
        if (r.left + r.width / 2 < mid) left = Math.max(left, Math.min(r.left + r.width, right - minWidth));
        else right = Math.min(right, Math.max(r.left, left + minWidth));
      }
      return { left, top: bounds.top, width: right - left, height: bounds.height };
    }
    // Which side of the window a strip (the native sidebar) is on.
    const sideOf = (rect, viewWidth) => (rect && rect.left + rect.width / 2 > viewWidth / 2 ? "right" : "left");
    // A button with a second action on a long press. The timer exists only between press and release.
    function createHoldAction({ ms = HOLD_MS, setTimer, clearTimer, onTap, onHold }) {
      let timer = null, held = false, down = false;
      const stop = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
      };
      return {
        press() {
          if (down) return;
          down = true;
          held = false;
          stop();
          timer = setTimer(() => {
            timer = null;
            held = true;
            onHold();
          }, ms);
        },
        release() {
          down = false;
          stop();
          return held;
        },
        cancel() {
          down = false;
          held = false;
          stop();
        },
        // The click that ends a hold is swallowed; any other click (mouse tap, Enter, Space) is a tap.
        click() {
          if (held) {
            held = false;
            return false;
          }
          onTap();
          return true;
        },
        get armed() {
          return timer !== null;
        },
      };
    }
    // Most recently opened note first, no duplicates, at most `max`.
    const pushRecent = (list, id, max = MAX_RECENT) => [id, ...(list || []).filter((x) => x !== id)].slice(0, max);
    const cleanRecent = (raw) =>
      Array.isArray(raw) ? raw.filter((x, i, a) => typeof x === "string" && x && x.length < 80 && a.indexOf(x) === i).slice(0, MAX_RECENT) : [];

    // ======================================================================
    // Store: notes as files, atomic writes, cross-window sync
    // ======================================================================
    function createStore({
      io,
      notify,
      windowId,
      now = () => Date.now(),
      getDir,
      getMaxSaveMs,
      setTimer,
      clearTimer,
      warn = () => {},
    }) {
      const notes = new Map();
      const dirty = new Set();
      const listeners = new Set();
      const backedUp = new Set();
      const DEFAULT_META = { lastNoteId: "", size: "peek", mode: "edit", highlight: "yellow", syncScroll: true, pinned: true, geo: {}, recent: [] };
      let meta = { ...DEFAULT_META };
      let dir = null;
      let chain = Promise.resolve();
      let retryTimer = null;
      let metaTimer = null;
      let metaDirty = false;
      let closed = false;
      const state = { save: "saved", error: "" };

      const emit = (type, id, extra = {}) => {
        for (const fn of [...listeners]) {
          try {
            fn({ type, id, ...extra });
          } catch (error) {
            warn(error);
          }
        }
      };
      const fileOf = (id) => io.join(dir, id + ".md");

      async function readNote(file) {
        const name = io.filename(file);
        const id = name.slice(0, -3);
        let text = null;
        for (const candidate of [file, file + ".bak"]) {
          try {
            const t = await io.readUTF8(candidate);
            if (t && t.trim()) {
              text = t;
              break;
            }
          } catch (_) {}
        }
        if (text === null) return null;
        let mtime = now();
        try {
          mtime = (await io.stat(file)).lastModified || mtime;
        } catch (_) {}
        return noteFromFile(id, text, mtime);
      }

      async function loadAll() {
        notes.clear();
        dirty.clear();
        let children = [];
        try {
          children = await io.children(dir);
        } catch (_) {}
        const found = await Promise.all(
          children
            .filter((p) => FILE_RE.test(io.filename(p)))
            .map((p) => readNote(p).catch(() => null)),
        );
        for (const note of found) if (note) notes.set(note.id, note);
      }

      async function loadMeta() {
        meta = { ...DEFAULT_META, geo: {}, recent: [] };
        try {
          const raw = JSON.parse(await io.readUTF8(io.join(dir, "meta.json")));
          if (typeof raw.lastNoteId === "string") meta.lastNoteId = raw.lastNoteId;
          if (raw.size === "full" || raw.size === "peek" || raw.size === "span") meta.size = raw.size;
          if (raw.mode === "read" || raw.mode === "edit" || raw.mode === "split") meta.mode = raw.mode;
          if (HIGHLIGHT_COLORS.includes(raw.highlight)) meta.highlight = raw.highlight;
          if (typeof raw.syncScroll === "boolean") meta.syncScroll = raw.syncScroll;
          if (typeof raw.pinned === "boolean") meta.pinned = raw.pinned;
          if (raw.geo && typeof raw.geo === "object")
            for (const key of GEO_KEYS) {
              const g = normalizeGeo(raw.geo[key]);
              if (g) meta.geo[key] = g;
            }
          meta.recent = cleanRecent(raw.recent);
        } catch (_) {}
      }

      function queue(task) {
        chain = chain.then(task).catch((error) => warn(error));
        return chain;
      }

      function writeMetaNow() {
        if (metaTimer !== null) clearTimer(metaTimer);
        metaTimer = null;
        if (!metaDirty || !dir) return Promise.resolve();
        metaDirty = false;
        const text = JSON.stringify(meta);
        return queue(() =>
          io.writeUTF8(io.join(dir, "meta.json"), text, {
            tmpPath: io.join(dir, "meta.json.tmp"),
          }),
        );
      }
      function setMeta(patch) {
        let changed = false;
        for (const [k, v] of Object.entries(patch))
          if (v && typeof v === "object" ? JSON.stringify(meta[k]) !== JSON.stringify(v) : meta[k] !== v) {
            meta[k] = v;
            changed = true;
          }
        if (!changed) return;
        metaDirty = true;
        if (metaTimer !== null) clearTimer(metaTimer);
        metaTimer = setTimer(writeMetaNow, 600);
      }

      async function writeNoteFile(note, text) {
        const file = fileOf(note.id);
        const opts = { tmpPath: file + ".tmp", flush: true };
        const wantBackup = note._onDisk && !backedUp.has(note.id);
        if (wantBackup) opts.backupFile = file + ".bak";
        await io.writeUTF8(file, text, opts);
        if (wantBackup) backedUp.add(note.id);
        if (!note._onDisk) {
          note._onDisk = true;
          try {
            await io.restrict(file);
          } catch (_) {}
        }
        note._mtime = now();
        notify({ id: note.id, origin: windowId, kind: "saved" });
      }

      function flushDirty() {
        return queue(async () => {
          if (closed || !dir) return;
          if (retryTimer !== null) {
            clearTimer(retryTimer);
            retryTimer = null;
          }
          state.save = "saving";
          emit("status");
          let failed = "";
          for (const id of [...dirty]) {
            const note = notes.get(id);
            if (!note) {
              dirty.delete(id);
              continue;
            }
            const snapshot = serializeNote(note);
            try {
              await writeNoteFile(note, snapshot);
              if (serializeNote(note) === snapshot) dirty.delete(id);
              else autosaver.touch();
            } catch (error) {
              failed = String(error?.message || error);
              warn(error);
            }
          }
          state.error = failed;
          state.save = failed ? "error" : dirty.size ? "dirty" : "saved";
          if (failed) retryTimer = setTimer(() => autosaver.touch(), 10000);
          emit("status");
        });
      }

      const autosaver = createAutosaver({
        idleMs: () => IDLE_SAVE_MS,
        maxMs: getMaxSaveMs,
        flush: flushDirty,
        setTimer,
        clearTimer,
      });

      function markDirty(id) {
        dirty.add(id);
        state.save = "dirty";
        emit("status");
        autosaver.touch();
      }

      async function reloadFromDisk(id) {
        const file = fileOf(id);
        let exists = false;
        try {
          exists = await io.exists(file);
        } catch (_) {}
        if (!exists) {
          if (notes.has(id) && !dirty.has(id)) {
            notes.delete(id);
            emit("remove", id, { remote: true });
          }
          return;
        }
        if (dirty.has(id)) return; // local edits win until they are saved
        const fresh = await readNote(file).catch(() => null);
        if (!fresh) return;
        notes.set(id, fresh);
        emit("change", id, { remote: true });
      }

      async function purgeOldTrash() {
        const limit = now() - TRASH_DAYS * 86400000;
        for (const note of [...notes.values()]) {
          if (note.trashed && note.trashed < limit) await removeNoteFiles(note.id);
        }
      }
      function removeNoteFiles(id) {
        notes.delete(id);
        dirty.delete(id);
        const file = fileOf(id);
        return queue(async () => {
          for (const p of [file, file + ".bak", file + ".tmp"])
            await io.remove(p).catch(() => {});
          notify({ id, origin: windowId, kind: "deleted" });
        });
      }

      const api = {
        state,
        get meta() {
          return meta;
        },
        get dir() {
          return dir;
        },
        on(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        async open() {
          closed = false;
          dir = await getDir();
          await loadAll();
          await loadMeta();
          await purgeOldTrash();
          emit("reset");
        },
        async switchDir() {
          await api.flush();
          await api.open();
        },
        get(id) {
          return notes.get(id) || null;
        },
        list({ query = "", trashed = false } = {}) {
          const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
          return [...notes.values()]
            .filter(
              (n) =>
                !!n.trashed === trashed &&
                terms.every((t) => n.body.toLowerCase().includes(t) || (n.label || "").toLowerCase().includes(t)),
            )
            .sort((a, b) =>
              trashed
                ? b.trashed - a.trashed
                : Number(b.pinned) - Number(a.pinned) || b.updated - a.updated,
            );
        },
        trashCount: () => [...notes.values()].filter((n) => n.trashed).length,
        latestId() {
          const last = notes.get(meta.lastNoteId);
          if (last && !last.trashed) return last.id;
          return api.list()[0]?.id || "";
        },
        create(body = "") {
          let id = makeId(now());
          while (notes.has(id)) id = makeId(now());
          const t = now();
          const note = {
            id,
            body,
            created: t,
            updated: t,
            color: "none",
            label: "",
            pinned: false,
            trashed: 0,
            _onDisk: false,
            _mtime: t,
          };
          notes.set(id, note);
          if (body) markDirty(id);
          emit("change", id, { created: true });
          return note;
        },
        update(id, body, source) {
          const note = notes.get(id);
          if (!note || note.body === body) return;
          note.body = body;
          note.updated = now();
          if (body.trim() || note._onDisk) markDirty(id);
          else dirty.delete(id);
          emit("change", id, { source });
        },
        setColor(id, color) {
          const note = notes.get(id);
          if (!note || !NOTE_COLORS.includes(color) || note.color === color) return;
          note.color = color;
          if (note.body.trim() || note._onDisk) markDirty(id);
          emit("change", id, { meta: true });
        },
        setLabel(id, label) {
          const note = notes.get(id);
          const next = cleanLabel(label);
          if (!note || (note.label || "") === next) return;
          note.label = next;
          if (note.body.trim() || note._onDisk) markDirty(id);
          emit("change", id, { meta: true });
        },
        setPinned(id, pinned) {
          const note = notes.get(id);
          if (!note || note.pinned === !!pinned) return;
          note.pinned = !!pinned;
          if (note.body.trim() || note._onDisk) markDirty(id);
          emit("change", id, { meta: true });
        },
        trash(id) {
          const note = notes.get(id);
          if (!note) return;
          if (!note._onDisk && !note.body.trim()) {
            notes.delete(id);
            emit("remove", id);
            return;
          }
          note.trashed = now();
          markDirty(id);
          emit("change", id, { meta: true });
        },
        restore(id) {
          const note = notes.get(id);
          if (!note || !note.trashed) return;
          note.trashed = 0;
          markDirty(id);
          emit("change", id, { meta: true });
        },
        async deleteForever(id) {
          await removeNoteFiles(id);
          emit("remove", id);
        },
        async emptyTrash() {
          for (const n of [...notes.values()])
            if (n.trashed) await removeNoteFiles(n.id);
          emit("reset");
        },
        // An untouched new note leaves no file behind.
        discardIfEmpty(id) {
          const note = notes.get(id);
          if (note && !note._onDisk && !note.body.trim()) {
            notes.delete(id);
            dirty.delete(id);
            emit("remove", id);
          }
        },
        setMeta,
        flush() {
          autosaver.cancel();
          return Promise.all([flushDirty(), writeMetaNow()]);
        },
        // Picks up files added or edited by other apps (sync tools, editors).
        async refresh() {
          if (!dir) return;
          let children = [];
          try {
            children = await io.children(dir);
          } catch (_) {
            return;
          }
          const present = new Set();
          for (const p of children) {
            const name = io.filename(p);
            if (!FILE_RE.test(name)) continue;
            const id = name.slice(0, -3);
            present.add(id);
            const known = notes.get(id);
            if (dirty.has(id)) continue;
            let mtime = 0;
            try {
              mtime = (await io.stat(p)).lastModified || 0;
            } catch (_) {}
            if (!known || mtime > known._mtime + 2000) await reloadFromDisk(id);
          }
          for (const [id, n] of [...notes]) {
            if (n._onDisk && !present.has(id) && !dirty.has(id)) {
              notes.delete(id);
              emit("remove", id, { remote: true });
            }
          }
        },
        onRemoteMessage(data) {
          let msg;
          try {
            msg = JSON.parse(data);
          } catch (_) {
            return;
          }
          if (!msg || msg.origin === windowId || !dir) return;
          if (typeof msg.id !== "string" || !/^[\w.-]+$/.test(msg.id)) return;
          reloadFromDisk(msg.id).catch(warn);
        },
        async close() {
          await api.flush();
          closed = true;
          if (retryTimer !== null) clearTimer(retryTimer);
          retryTimer = null;
        },
      };
      return api;
    }

    // ======================================================================
    // Test seam (unit tests only; absent in Zen)
    // ======================================================================
    // Menu placement (pure): right-aligned to the anchor, kept inside both the host sheet and the
    // viewport, flipped above the anchor when there is no room below, and given a max height (so it
    // scrolls) when it is taller than the available space. Returns coordinates relative to the host.
    function menuPosition({ anchor, host, viewport, size, pad = 6 }) {
      const minX = Math.max(pad, host.left + 4),
        maxX = Math.min(viewport.width - pad, host.right - 4);
      const minY = Math.max(pad, host.top + 4),
        maxY = Math.min(viewport.height - pad, host.bottom - 4);
      const width = Math.min(size.width, Math.max(0, maxX - minX));
      let height = size.height;
      const below = maxY - (anchor.bottom + 4),
        above = anchor.top - 4 - minY;
      const useBelow = height <= below || below >= above;
      const room = Math.max(60, useBelow ? below : above);
      let maxHeight = 0;
      if (height > room) {
        maxHeight = Math.floor(room);
        height = room;
      }
      const x = Math.max(minX, Math.min(anchor.right - width, maxX - width));
      const y = useBelow ? anchor.bottom + 4 : anchor.top - 4 - height;
      return {
        left: Math.round(x - host.left),
        top: Math.round(Math.max(minY, y) - host.top),
        maxHeight,
      };
    }

    if (window.__zentralNotesTestSeam) {
      window.__zentralNotesTestSeam.core = {
        makeId, parseNoteText, noteFromFile, serializeNote, titleOf, snippetOf,
        wordCount, safeFileName, createAutosaver, parseInline, parseBlocks,
        wrapSelection, toggleLinePrefix, continueList, toggleCheckboxLine, insertRule, nestLines,
        diffSigs, blockSig, exportHtml, exportText, uniqueFileNames, EXPORT_FORMATS,
        createStore, safeHref, FILE_RE, createSheet, parseShortcut, matchesShortcut, menuPosition,
        highlightCode, codeLangKey, texNodes, mapPosition, mergeAnchors, insertCodeBlock, buildLink, insertLink,
        pastedLink, fragmentLabel, insertImage, makeTable, insertTable, SHORTCUT_ACTIONS, formatCombo,
        normalizeCombo, comboFromEvent, parseShortcutMap, effectiveShortcuts, findShortcutConflict,
        matchShortcutAction, assignShortcut, QUICK_OPTIONS, stepOption, PREF,
        alignDelim, buildImage, insertImageMd, pastedWebAddress, CODE_LANGS, CALLOUT_KINDS, calloutId, insertCallout,
        HIDEABLE_TOOLS, parseHidden, serializeHidden,
        normalizeGeo, clampGeo, moveGeo, resizeGeo, placeSheet, keepClear, sideOf, createHoldAction,
        pushRecent, cleanRecent, GEO_MIN, RESIZE_HANDLES,
        cleanLabel, NOTE_THEMES, normalizeTheme, pushAmount, companionRect,
      };
    }

    // ======================================================================
    // UI helpers (DOM is only ever built with createElement / textContent)
    // ======================================================================
    const SVG_NS = "http://www.w3.org/2000/svg";
    const ICONS = {
      note: "M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z M15 3v6h6",
      list: "M4 6h16M4 12h16M4 18h16",
      plus: "M12 5v14M5 12h14",
      x: "M18 6 6 18M6 6l12 12",
      pin: "M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
      trash: "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
      more: "M5 12h.01M12 12h.01M19 12h.01",
      bold: "M6 4h8a4 4 0 0 1 0 8H6z M6 12h9a4 4 0 0 1 0 8H6z",
      italic: "M19 4h-9 M14 20H5 M15 4 9 20",
      strike: "M16 4H9a3 3 0 0 0-2.83 4 M14 12a4 4 0 0 1 0 8H6 M4 12h16",
      highlight: "m9 11-6 6v3h9l3-3 M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
      check: "m9 11 3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
      bullets: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
      heading: "M6 12h12 M6 20V4 M18 20V4",
      eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
      edit: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
      maximize: "M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3",
      minimize: "M8 3v3a2 2 0 0 1-2 2H3 M21 8h-3a2 2 0 0 1-2-2V3 M3 16h3a2 2 0 0 1 2 2v3 M16 21v-3a2 2 0 0 1 2-2h3",
      search: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M21 21l-4.3-4.3",
      back: "M19 12H5 M12 19l-7-7 7-7",
      save: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
      copy: "M8 8h12v12H8z M4 16V4h12",
      folder: "M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
      restore: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5",
      duplicate: "M9 9h11v11H9z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
      caret: "m6 9 6 6 6-6",
      columns: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M12 3v18",
      image: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21",
      rule: "M4 12h16",
      quote: "M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z",
      indent: "M3 8l4 4-4 4 M21 12H11 M21 6H11 M21 18H11",
      outdent: "M7 8l-4 4 4 4 M21 12H11 M21 6H11 M21 18H11",
      link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
      code: "m16 18 6-6-6-6 M8 6l-6 6 6 6",
      codeblock: "M4 4h16v16H4z M10 9l-3 3 3 3 M14 9l3 3-3 3",
      numbered: "M10 6h11 M10 12h11 M10 18h11 M4 6h1v4 M4 10h2 M4 14.5a1.5 1 0 0 1 3 0c0 1-3 2-3 3.5h3",
      table: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 10h18 M3 15h18 M9 3v18 M15 3v18",
      bookmark: "m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z",
      sliders: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
    };
    function icon(name, size = 14) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", name === "more" ? "3" : "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", ICONS[name] || "");
      svg.appendChild(path);
      return svg;
    }
    function h(tag, attrs, ...kids) {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v === false || v === null || v === undefined) continue;
        if (k === "class") node.className = v;
        else node.setAttribute(k, v === true ? "" : String(v));
      }
      for (const kid of kids)
        if (kid !== null && kid !== undefined && kid !== false)
          node.append(typeof kid === "string" ? document.createTextNode(kid) : kid);
      return node;
    }
    function iconButton(name, title, cls = "") {
      const b = h("button", {
        type: "button",
        class: ("zn-btn " + cls).trim(),
        title,
        "aria-label": title,
      });
      b.appendChild(icon(name));
      return b;
    }
    function relativeTime(t) {
      const d = new Date(t),
        n = new Date();
      if (d.toDateString() === n.toDateString())
        return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(d.getFullYear() === n.getFullYear() ? {} : { year: "2-digit" }),
      });
    }

    function renderInline(parent, nodes, env) {
      for (const n of nodes) {
        if (n.t === "text") parent.append(document.createTextNode(n.s));
        else if (n.t === "br") parent.append(document.createElement("br"));
        else if (n.t === "img") {
          // Nothing is fetched until the person clicks: opening a note must not contact a server.
          const btn = h("button", { type: "button", class: "zn-img", title: "Load image: " + n.href });
          btn.append(icon("image", 12), h("span", {}, n.alt || "image"));
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const img = h("img", { class: "zn-img-loaded", alt: n.alt, src: n.href, loading: "lazy" });
            btn.replaceWith(img);
          });
          parent.append(btn);
        } else if (n.t === "code" || n.t === "kbd") {
          const c = h(n.t === "kbd" ? "kbd" : "code");
          c.textContent = n.s;
          parent.append(c);
        } else {
          const tag = { b: "strong", i: "em", s: "del", hl: "mark", a: "span", sub: "sub", sup: "sup", math: "span" }[n.t];
          if (!tag) continue;
          const node = h(tag);
          if (n.t === "math") node.className = "zn-math";
          else if (n.t === "hl") {
            node.className = "zn-hl";
            node.dataset.color = n.color;
          } else if (n.t === "a") {
            // No href attribute: a real link inside browser chrome could
            // navigate the window. Clicks go through env.openLink instead.
            node.className = "zn-link";
            node.dataset.href = n.href;
            node.setAttribute("role", "link");
            node.setAttribute("tabindex", "0");
            node.title = n.title ? n.title + "\n" + n.href : n.href;
            node.addEventListener("click", (e) => {
              e.preventDefault();
              env.openLink(n.href);
            });
            node.addEventListener("keydown", (e) => {
              if (e.key === "Enter") env.openLink(n.href);
            });
          }
          renderInline(node, n.c, env);
          parent.append(node);
        }
      }
    }
    function renderBlocks(parent, blocks, env, onToggle) {
      for (const b of blocks) {
        if (b.type === "h") {
          const node = h("h" + b.level, { class: "zn-h" });
          renderInline(node, b.c, env);
          parent.append(node);
        } else if (b.type === "p") {
          const node = h("p", { class: "zn-p" });
          renderInline(node, b.c, env);
          parent.append(node);
        } else if (b.type === "math") {
          const node = h("div", { class: "zn-math zn-math-block" });
          renderInline(node, b.c, env);
          parent.append(node);
        } else if (b.type === "details") {
          // A button + div instead of a native <details>: same behaviour in chrome and in the tests, and the
          // open state is only view state (it is not saved in the note).
          const box = h("div", { class: "zn-details" });
          const body = h("div", { class: "zn-details-body" });
          const head = h("button", { type: "button", class: "zn-details-sum", "aria-expanded": b.open ? "true" : "false" });
          const label = h("span", { class: "zn-details-label" });
          if (b.summary.length) renderInline(label, b.summary, env);
          else label.textContent = "Details";
          head.append(h("span", { class: "zn-details-arrow", "aria-hidden": "true" }), label);
          body.hidden = !b.open;
          head.addEventListener("click", (e) => {
            e.stopPropagation();
            const on = head.getAttribute("aria-expanded") !== "true";
            head.setAttribute("aria-expanded", on ? "true" : "false");
            body.hidden = !on;
          });
          renderBlocks(body, b.blocks, env, onToggle);
          box.append(head, body);
          parent.append(box);
        } else if (b.type === "gap") {
          const gap = h("div", { class: "zn-gap", "aria-hidden": "true" });
          gap.style.setProperty("--n", String(Math.min(b.n, 20)));
          parent.append(gap);
        } else if (b.type === "hr") parent.append(h("hr", { class: "zn-hr" }));
        else if (b.type === "code") {
          const code = h("code");
          if (codeLangKey(b.lang)) {
            for (const tk of highlightCode(b.text, b.lang)) {
              if (!tk.k) code.append(document.createTextNode(tk.s));
              else {
                const span = h("span", { class: "zn-tk" });
                span.dataset.k = tk.k;
                span.textContent = tk.s;
                code.append(span);
              }
            }
          } else code.textContent = b.text;
          const pre = h("pre", { class: "zn-pre" }, code);
          if (b.lang) pre.dataset.lang = b.lang;
          parent.append(pre);
        } else if (b.type === "table") {
          const table = h("table", { class: "zn-table" });
          const row = (tag, cells) => {
            const tr = h("tr");
            cells.forEach((c, i) => {
              const cell = h(tag);
              if (b.align[i]) cell.style.textAlign = b.align[i];
              renderInline(cell, c, env);
              tr.append(cell);
            });
            return tr;
          };
          table.append(h("thead", {}, row("th", b.head)), h("tbody", {}, ...b.rows.map((r) => row("td", r))));
          parent.append(h("div", { class: "zn-table-wrap" }, table));
        } else if (b.type === "quote") {
          const node = h("blockquote", { class: b.callout ? "zn-quote zn-callout" : "zn-quote" });
          if (b.callout) {
            node.dataset.kind = b.callout.kind;
            node.append(h("div", { class: "zn-callout-title" }, b.callout.title || b.callout.kind[0].toUpperCase() + b.callout.kind.slice(1)));
          }
          renderBlocks(node, b.blocks, env, onToggle);
          parent.append(node);
        } else if (b.type === "list") {
          for (const item of b.items) {
            const row = h("div", { class: "zn-li" });
            row.style.setProperty("--lvl", String(item.level));
            let marker;
            if (item.checked === null) marker = h("span", { class: "zn-marker" }, item.marker);
            else {
              marker = h("button", {
                type: "button",
                class: "zn-check",
                role: "checkbox",
                "aria-checked": item.checked ? "true" : "false",
                "aria-label": "Toggle item",
              });
              if (item.checked) marker.dataset.on = "true";
              if (item.line < 0) marker.disabled = true;
              else marker.addEventListener("click", () => onToggle(item.line));
            }
            const text = h("span", { class: "zn-li-text" });
            if (item.checked) text.dataset.done = "true";
            renderInline(text, item.c, env);
            row.append(marker, text);
            parent.append(row);
            for (const para of item.more || []) {
              const more = h("p", { class: "zn-li-more" });
              more.style.setProperty("--lvl", String(item.level));
              renderInline(more, para, env);
              parent.append(more);
            }
          }
        }
      }
    }

    // ======================================================================
    // Sheet: one editor view; many can exist, all bound to the same store
    // ======================================================================
    function createSheet({ store, adapter, env, ensureStore, companion = null }) {
      const token = {};
      const cleanups = [];
      const listen = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        cleanups.push(() => target.removeEventListener(type, fn, opts));
      };
      let currentId = "";
      let view = "editor"; // editor | list
      let mode = "edit"; // edit | read | split
      let filter = "all"; // all | recent | trash
      let query = "";
      let isOpen = false;
      let typed = false;
      let menu = null;
      let rafChrome = 0,
        rafList = 0,
        rafLayout = 0;
      let unwatch = null;
      let confirmTimer = 0;
      let destroyed = false;
      let previewTimer = 0; // armed only while split view waits for typing to pause
      let flashTimer = 0; // armed only while a short message is showing
      let flashMsg = "";
      let readAnch = []; // [{ line, node }] first node of each block / list item, for linked scrolling
      let readAnchY = null; // the same with measured offsets; dropped whenever the pane changes
      let taAnchY = null; // source line -> editor offset (measured lazily with a hidden mirror)
      let mirror = null;
      let readSigs = []; // signatures of the blocks drawn in the read/preview pane
      let readNodes = []; // DOM nodes per drawn block
      let readEmpty = false;
      let dialog = null; // export notice
      let tucked = false; // hover reveal: open but slid away, a thin strip on the top edge brings it back
      let revealEl = null;
      let revealTimer = 0; // armed only while the pointer rests on the strip
      let peerRoot = null; // the other window of a two-window split view: pressing in it is not "outside"
      let comp = null; // the second window (a sheet of its own) while the split view uses two windows

      // ---- DOM -----------------------------------------------------------
      const root = h("div", {
        class: "zentral-notes-sheet",
        role: "dialog",
        "aria-label": "Notes",
      });
      root.hidden = true;
      const btnList = iconButton("list", "All notes (Ctrl+K)", "zn-list-btn");
      const titleEl = h("button", { type: "button", class: "zn-title", title: "All notes" });
      const btnPin = iconButton("bookmark", "Pin note to the top of the list");
      // The window pin works like the pin of a Zentral panel: pinned = stays open, unpinned = closes on an
      // outside click. Hold it to put the window back in its default place.
      const btnKeep = iconButton("pin", "Keep open", "zn-keep-btn");
      const colorDot = h("span", { class: "zn-dot" });
      const btnColor = h("button", {
        type: "button",
        class: "zn-btn",
        title: "Note color",
        "aria-label": "Note color",
      });
      btnColor.append(colorDot);
      const btnSize = iconButton("maximize", "Larger (hold: fill the whole area)");
      const btnMore = iconButton("more", "More");
      const btnClose = iconButton("x", "Close notes (Esc)");
      const labelEl = h("button", { type: "button", class: "zn-label", title: "Edit label" });
      labelEl.hidden = true;
      const head = h("div", { class: "zn-head" }, btnList, titleEl, labelEl, btnPin, btnColor, btnKeep, btnSize, btnMore, btnClose);

      const tBold = iconButton("bold", "Bold (Ctrl+B)");
      const tItalic = iconButton("italic", "Italic (Ctrl+I)");
      const tStrike = iconButton("strike", "Strikethrough");
      const tHl = iconButton("highlight", "Highlight selection (Ctrl+Shift+H)", "zn-hl-btn");
      const hlDot = h("span", { class: "zn-hl-dot" });
      tHl.append(hlDot);
      const tHlMenu = iconButton("caret", "Highlight color", "zn-caret");
      const tHeading = iconButton("heading", "Heading");
      const tBullet = iconButton("bullets", "Bulleted list");
      const tCheck = iconButton("check", "Checklist");
      const tQuote = iconButton("quote", "Quote (nest deeper with the indent button)");
      const tOutdent = iconButton("outdent", "Nest out: list or quote one level up");
      const tIndent = iconButton("indent", "Nest in: list or quote one level deeper");
      const tRule = iconButton("rule", "Horizontal rule");
      const tCode = iconButton("code", "Inline code");
      const tCodeBlock = iconButton("codeblock", "Code block");
      const tLink = iconButton("link", "Link\u2026");
      const tImage = iconButton("image", "Image");
      const tNumbered = iconButton("numbered", "Numbered list");
      const tTable = iconButton("table", "Table\u2026");
      const tInsert = iconButton("caret", "More: callouts, superscript, subscript, keyboard key", "zn-caret");
      const tSettings = iconButton("sliders", "Quick settings", "zn-mode-btn");
      const tSync = iconButton("link", "Linked scrolling", "zn-mode-btn zn-sync-btn");
      const tSplit = iconButton("columns", "Split view: editor and preview", "zn-mode-btn");
      const tMode = iconButton("eye", "Read (Ctrl+E)", "zn-mode-btn");
      const TOOL_TITLES = [
        [tBold, "Bold", "bold"], [tItalic, "Italic", "italic"], [tStrike, "Strikethrough", "strike"],
        [tHl, "Highlight selection", "highlight"], [tHeading, "Heading", "heading"], [tBullet, "Bulleted list", "bullet"],
        [tNumbered, "Numbered list", "numbered"], [tCheck, "Checklist", "check"], [tQuote, "Quote (nest deeper with the indent button)", "quote"],
        [tOutdent, "Nest out: list or quote one level up", "outdent"], [tIndent, "Nest in: list or quote one level deeper", "indent"],
        [tRule, "Horizontal rule", "rule"], [tCode, "Inline code", "code"], [tCodeBlock, "Code block", "codeBlock"],
        [tLink, "Link\u2026", "link"], [tImage, "Image", "image"], [tTable, "Table\u2026", "table"], [tSettings, "Quick settings", "settings"],
      ];
      const getPref = (k, d) => (env.getPref ? env.getPref(k, d) : d);
      const setPref = (k, v) => env.setPref?.(k, v);
      let shortcutCache = { raw: null, hid: null, list: [] };
      const hiddenTools = () => parseHidden(getPref(PREF.HIDDEN_TOOLS, ""));
      function shortcutList() {
        const raw = String(getPref(PREF.SHORTCUTS, "") || "");
        const hid = String(getPref(PREF.HIDDEN_TOOLS, "") || "");
        if (shortcutCache.raw !== raw || shortcutCache.hid !== hid) {
          const gone = parseHidden(hid);
          shortcutCache = { raw, hid, list: effectiveShortcuts(parseShortcutMap(raw)).filter((x) => !gone.has(x.id)) };
        }
        return shortcutCache.list;
      }
      const tools = h(
        "div",
        { class: "zn-tools" },
        tBold, tItalic, tStrike, tHl, tHlMenu, tHeading, tBullet, tNumbered, tCheck, tQuote, tOutdent, tIndent, tRule,
        tCode, tCodeBlock, tLink, tImage, tTable, tInsert,
        h("span", { class: "zn-grow" }),
        tSettings,
        tSync,
        tSplit,
        tMode,
      );

      const ta = h("textarea", {
        class: "zn-editor",
        spellcheck: "true",
        placeholder: "Start writing\u2026 the first line is the title.",
        "aria-label": "Note text",
      });
      const readEl = h("div", { class: "zn-read", tabindex: "0" });
      const search = h("input", {
        type: "text",
        class: "zn-search",
        placeholder: "Search notes",
        "aria-label": "Search notes",
        spellcheck: "false",
      });
      const btnNew = iconButton("plus", "New note (Ctrl+N)", "zn-new");
      const chipAll = h("button", { type: "button", class: "zn-chip" }, "Notes");
      const chipRecent = h("button", { type: "button", class: "zn-chip" }, "Recent");
      const chipTrash = h("button", { type: "button", class: "zn-chip" }, "Trash");
      const chipEmpty = h("button", { type: "button", class: "zn-chip zn-chip-danger" }, "Empty trash");
      const listItems = h("div", { class: "zn-items", role: "list" });
      const listEl = h(
        "div",
        { class: "zn-list" },
        h("div", { class: "zn-list-head" }, h("span", { class: "zn-search-wrap" }, icon("search", 13), search), btnNew),
        h("div", { class: "zn-chips" }, chipAll, chipRecent, chipTrash, h("span", { class: "zn-grow" }), chipEmpty),
        listItems,
      );
      const body = h("div", { class: "zn-body" }, ta, readEl, listEl);
      const statusEl = h("span", { class: "zn-status", "aria-live": "polite" });
      const countEl = h("span", { class: "zn-count" });
      const foot = h("div", { class: "zn-foot" }, statusEl, h("span", { class: "zn-grow" }), countEl);
      root.append(head, tools, body, foot);
      // Eight resize grips (edges and corners); CSS shows them only where the sheet may be moved.
      for (const hd of RESIZE_HANDLES) root.append(h("span", { class: "zn-rz", "data-h": hd }));

      // ---- state -> DOM ----------------------------------------------------
      const note = () => store.get(currentId);
      // Split view as two windows: only where the sheet floats over a host and the option is on.
      const twoWin = () => mode === "split" && !companion && !!adapter.position && !!getPref(PREF.SPLIT_WINDOW, false);
      function applyState() {
        const n = note();
        root.dataset.view = view;
        root.dataset.mode = twoWin() ? "edit" : mode;
        root.dataset.win = twoWin() ? "two" : "one";
        root.dataset.size = store.meta.size;
        labelEl.hidden = !n?.label || view === "list";
        labelEl.textContent = n?.label || "";
        tSplit.hidden = !!companion;
        root.dataset.color = n?.color || "none";
        root.dataset.trashed = n?.trashed ? "true" : "false";
        titleEl.textContent =
          view === "list" ? (filter === "trash" ? "Trash" : "All notes") : titleOf(n?.body || "") || "Untitled note";
        titleEl.title = view === "list" ? "Back to note" : "All notes";
        btnPin.classList.toggle("is-on", !!n?.pinned);
        btnPin.title = n?.pinned ? "Unpin note" : "Pin note to the top of the list";
        btnPin.setAttribute("aria-pressed", n?.pinned ? "true" : "false");
        colorDot.dataset.color = n?.color || "none";
        const big = store.meta.size !== "peek";
        btnSize.replaceChildren(icon(big ? "minimize" : "maximize"));
        btnSize.title = big ? "Smaller (hold: fill the whole area)" : "Larger (hold: fill the whole area)";
        root.dataset.geo = adapter.geoKey ? "on" : "off";
        btnKeep.classList.toggle("is-on", store.meta.pinned !== false);
        btnKeep.setAttribute("aria-pressed", store.meta.pinned !== false ? "true" : "false");
        btnKeep.title = store.meta.pinned !== false ? "Kept open: click to close on an outside click (hold: reset position)" : "Closes on an outside click: click to keep open (hold: reset position)";
        tSync.hidden = mode !== "split";
        tSync.classList.toggle("is-on", !!store.meta.syncScroll);
        tSync.setAttribute("aria-pressed", store.meta.syncScroll ? "true" : "false");
        tSync.title = store.meta.syncScroll ? "Linked scrolling: on (click to unlink)" : "Linked scrolling: off (click to link)";
        tSplit.classList.toggle("is-on", mode === "split");
        tSplit.setAttribute("aria-pressed", mode === "split" ? "true" : "false");
        tSplit.title = mode === "split" ? "Close split view" : "Split view: editor and preview";
        tMode.replaceChildren(icon(mode === "read" ? "edit" : "eye"));
        tMode.title = mode === "read" ? "Edit (Ctrl+E)" : "Read (Ctrl+E)";
        hlDot.dataset.color = store.meta.highlight;
        const gone = hiddenTools();
        for (const [btn, base, id] of TOOL_TITLES) {
          const combo = shortcutList().find((x) => x.id === id)?.combo;
          btn.title = combo ? `${base} (${combo})` : base;
          if (id !== "settings") btn.hidden = gone.has(id);
        }
        tHlMenu.hidden = gone.has("highlight");
        tInsert.hidden = ["sup", "sub", "kbd", ...CALLOUT_KINDS.map(([k]) => calloutId(k))].every((id) => gone.has(id));
        ta.readOnly = !!n?.trashed;
        ta.hidden = mode === "read";
        readEl.hidden = mode === "edit" || twoWin();
        chipAll.classList.toggle("is-on", filter === "all");
        chipRecent.classList.toggle("is-on", filter === "recent");
        chipTrash.classList.toggle("is-on", filter === "trash");
        chipTrash.textContent = store.trashCount() ? `Trash (${store.trashCount()})` : "Trash";
        chipEmpty.hidden = filter !== "trash" || !store.trashCount();
        syncCompanion();
      }
      function updateChrome() {
        rafChrome = 0;
        const n = note();
        if (n) {
          titleEl.textContent =
            view === "list" ? titleEl.textContent : titleOf(n.body) || "Untitled note";
          countEl.textContent = `${wordCount(n.body)} words`;
        } else countEl.textContent = "";
        const s = store.state;
        statusEl.dataset.state = s.save;
        statusEl.textContent =
          flashMsg ||
          { saved: "Saved", dirty: "Unsaved\u2026", saving: "Saving\u2026", error: "Couldn\u2019t save, retrying" }[s.save] ||
          "";
        statusEl.title = s.error || "";
      }
      const scheduleChrome = () => {
        if (!rafChrome) rafChrome = window.requestAnimationFrame(updateChrome);
      };
      // Draws only the blocks that changed since the last draw (see diffSigs). A note switch or a
      // changed read option starts from scratch.
      function resetRead() {
        readEl.replaceChildren();
        readSigs = [];
        readNodes = [];
        readAnch = [];
        readAnchY = null;
        readEmpty = false;
      }
      function buildReadAnchors(blocks) {
        readAnch = [];
        readAnchY = null;
        blocks.forEach((b, i) => {
          const nodes = readNodes[i] || [];
          if (b.type === "list") {
            let k = 0;
            for (const it of b.items) {
              if (nodes[k] && it.line >= 0) readAnch.push({ line: it.line, node: nodes[k] });
              k += 1 + (it.more ? it.more.length : 0);
            }
          } else if (nodes[0] && b.src !== undefined) readAnch.push({ line: b.src, node: nodes[0] });
        });
      }
      function renderRead() {
        const n = note();
        if (!n || !n.body.trim()) {
          resetRead();
          readEmpty = true;
          readEl.append(h("p", { class: "zn-empty" }, "Nothing here yet. Switch to edit and start writing."));
          return;
        }
        if (readEmpty) resetRead();
        const blocks = parseBlocks(n.body, false, env.readOpts?.() || {});
        const sigs = blocks.map(blockSig);
        const { prefix, suffix } = diffSigs(readSigs, sigs);
        if (prefix === readSigs.length && prefix === sigs.length) {
          buildReadAnchors(blocks);
          return;
        }
        const tail = readNodes.slice(readNodes.length - suffix);
        for (const nodes of readNodes.slice(prefix, readNodes.length - suffix)) for (const nd of nodes) nd.remove();
        const anchor = tail.find((nodes) => nodes.length)?.[0] || null;
        const fresh = [];
        for (let i = prefix; i < blocks.length - suffix; i++) {
          const tmp = h("div");
          renderBlocks(tmp, [blocks[i]], env, (line) => setBody(toggleCheckboxLine(note().body, line)));
          const nodes = [...tmp.childNodes];
          for (const nd of nodes) readEl.insertBefore(nd, anchor);
          fresh.push(nodes);
        }
        readNodes = [...readNodes.slice(0, prefix), ...fresh, ...tail];
        readSigs = sigs;
        buildReadAnchors(blocks);
      }
      function schedulePreview() {
        window.clearTimeout(previewTimer);
        previewTimer = window.setTimeout(() => {
          previewTimer = 0;
          if (isOpen && !destroyed && view === "editor" && mode !== "edit") renderRead();
        }, PREVIEW_IDLE_MS);
      }
      function flash(message, ms = 4000) {
        flashMsg = message;
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => {
          flashTimer = 0;
          flashMsg = "";
          scheduleChrome();
        }, ms);
        scheduleChrome();
      }
      function setBody(text) {
        store.update(currentId, text, null);
        const st = ta.scrollTop;
        ta.value = text;
        ta.scrollTop = st;
        typed = false;
        if (mode !== "edit") renderRead();
        scheduleChrome();
      }
      function showNote(id) {
        currentId = id;
        const n = note();
        ta.value = n ? n.body : "";
        typed = false;
        window.clearTimeout(previewTimer);
        resetRead();
        if (mode !== "edit") renderRead();
        applyState();
        updateChrome();
      }
      function focusEditor() {
        if (view !== "editor") return;
        const target = mode === "read" ? readEl : ta;
        try {
          target.focus({ preventScroll: true });
          if (mode !== "read") ta.setSelectionRange(ta.value.length, ta.value.length);
        } catch (_) {}
      }
      function openNote(id, { focus = true } = {}) {
        if (currentId && currentId !== id) store.discardIfEmpty(currentId);
        if (!companion) store.setMeta({ lastNoteId: id, recent: pushRecent(store.meta.recent, id) });
        view = "editor";
        const n = store.get(id);
        mode = n?.trashed ? "read" : companion ? mode : store.meta.mode;
        showNote(id);
        if (focus) focusEditor();
      }
      function newNote() {
        const n = store.create("");
        mode = "edit";
        if (!companion) store.setMeta({ mode: "edit" });
        openNote(n.id);
      }
      function setMode(next) {
        if (mode === next) return;
        mode = next;
        if (!note()?.trashed && !companion) store.setMeta({ mode });
        if (mode !== "edit") renderRead();
        applyState();
        scheduleLayout();
        focusEditor();
      }
      function showList() {
        view = "list";
        applyState();
        renderList();
        window.requestAnimationFrame(() => {
          try {
            search.focus({ preventScroll: true });
            search.select();
          } catch (_) {}
        });
      }
      function showEditor() {
        if (!currentId || !store.get(currentId)) {
          const id = store.latestId();
          if (id) openNote(id);
          else newNote();
          return;
        }
        view = "editor";
        applyState();
        focusEditor();
      }

      // ---- list view -----------------------------------------------------------
      // The last opened notes, newest first, narrowed by the search box.
      function recentNotes() {
        const q = query.trim().toLowerCase();
        return (store.meta.recent || [])
          .map((id) => store.get(id))
          .filter((n) => n && !n.trashed && (!q || n.body.toLowerCase().includes(q) || (n.label || "").toLowerCase().includes(q)));
      }
      function renderList() {
        rafList = 0;
        if (view !== "list") return;
        applyState();
        const trashed = filter === "trash";
        const all = filter === "recent" ? recentNotes() : store.list({ query, trashed });
        listItems.replaceChildren();
        if (!all.length) {
          listItems.append(
            h("p", { class: "zn-empty" }, query ? "No notes match your search." : trashed ? "Trash is empty." : filter === "recent" ? "Nothing opened yet." : "No notes yet. Press + to create one."),
          );
          return;
        }
        for (const n of all.slice(0, MAX_LIST_ROWS)) {
          const item = h("div", { class: "zn-item", role: "listitem", tabindex: "0", "data-id": n.id });
          item.dataset.color = n.color;
          if (n.id === currentId) item.classList.add("is-current");
          const act = h("span", { class: "zn-item-actions" });
          if (trashed) {
            const r = iconButton("restore", "Restore");
            r.addEventListener("click", (e) => {
              e.stopPropagation();
              store.restore(n.id);
              scheduleList();
            });
            const d = iconButton("trash", "Delete forever", "zn-danger");
            d.addEventListener("click", (e) => {
              e.stopPropagation();
              if (d.dataset.armed) {
                store.deleteForever(n.id).then(scheduleList);
              } else {
                d.dataset.armed = "true";
                d.title = "Click again to delete forever";
                window.clearTimeout(confirmTimer);
                confirmTimer = window.setTimeout(() => {
                  delete d.dataset.armed;
                  d.title = "Delete forever";
                }, 3000);
              }
            });
            act.append(r, d);
          } else {
            const p = iconButton("pin", n.pinned ? "Unpin" : "Pin", n.pinned ? "is-on" : "");
            p.addEventListener("click", (e) => {
              e.stopPropagation();
              store.setPinned(n.id, !n.pinned);
              scheduleList();
            });
            const t = iconButton("trash", "Move to trash");
            t.addEventListener("click", (e) => {
              e.stopPropagation();
              store.trash(n.id);
              if (n.id === currentId) currentId = "";
              scheduleList();
            });
            act.append(p, t);
          }
          item.append(
            h("span", { class: "zn-item-bar" }),
            h(
              "span",
              { class: "zn-item-main" },
              h("span", { class: "zn-item-title" }, (n.pinned ? "\u{1F4CC} " : "") + (titleOf(n.body) || "Untitled note")),
              ...(n.label ? [h("span", { class: "zn-item-label" }, n.label)] : []),
              h("span", { class: "zn-item-snippet" }, snippetOf(n.body)),
            ),
            h("span", { class: "zn-item-time" }, relativeTime(trashed ? n.trashed : n.updated)),
            act,
          );
          const open = () => {
            openNote(n.id);
          };
          item.addEventListener("click", open);
          item.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              open();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              (item.nextElementSibling || item).focus?.();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (item.previousElementSibling) item.previousElementSibling.focus();
              else search.focus();
            }
          });
          listItems.append(item);
        }
        if (all.length > MAX_LIST_ROWS)
          listItems.append(h("p", { class: "zn-empty" }, `Showing the first ${MAX_LIST_ROWS} of ${all.length}. Use search to narrow down.`));
      }
      const scheduleList = () => {
        if (!rafList) rafList = window.requestAnimationFrame(renderList);
      };

      // ---- editing ---------------------------------------------------------------
      function applyEdit(e) {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(e.start, e.end);
        const before = ta.value;
        const expected = before.slice(0, e.start) + e.text + before.slice(e.end);
        let done = false;
        try {
          // execCommand keeps the native undo stack intact.
          done =
            e.text === ""
              ? e.start === e.end || document.execCommand("delete")
              : document.execCommand("insertText", false, e.text);
        } catch (_) {}
        if (!done || ta.value !== expected) {
          ta.value = expected; // always correct, but loses undo for this step
          ta.dispatchEvent(new Event("input", { bubbles: true }));
        }
        ta.setSelectionRange(e.selStart, e.selEnd);
      }
      const sel = () => [ta.selectionStart, ta.selectionEnd];
      const hlOpen = () => (store.meta.highlight === "yellow" ? "==" : `=={${store.meta.highlight}}`);
      const fmt = {
        code: () => applyEdit(wrapSelection(ta.value, ...sel(), "`")),
        codeBlock: () => askCodeBlock(),
        numbered: () => applyEdit(toggleLinePrefix(ta.value, ...sel(), "ordered")),
        image: () => askImage(),
        rule: () => applyEdit(insertRule(ta.value, ...sel())),
        sup: () => applyEdit(wrapSelection(ta.value, ...sel(), "^")),
        sub: () => applyEdit(wrapSelection(ta.value, ...sel(), "~")),
        kbd: () => applyEdit(wrapSelection(ta.value, ...sel(), "<kbd>", "</kbd>")),
        link: () => askLink(),
        table: () => askTable(),
        bold: () => applyEdit(wrapSelection(ta.value, ...sel(), "**")),
        italic: () => applyEdit(wrapSelection(ta.value, ...sel(), "*")),
        strike: () => applyEdit(wrapSelection(ta.value, ...sel(), "~~")),
        highlight: () => applyEdit(wrapSelection(ta.value, ...sel(), hlOpen(), "==")),
        heading: () => applyEdit(toggleLinePrefix(ta.value, ...sel(), "heading")),
        bullet: () => applyEdit(toggleLinePrefix(ta.value, ...sel(), "bullet")),
        check: () => applyEdit(toggleLinePrefix(ta.value, ...sel(), "check")),
        quote: () => applyEdit(toggleLinePrefix(ta.value, ...sel(), "quote")),
        indent: () => applyEdit(nestLines(ta.value, ...sel(), 1)),
        outdent: () => applyEdit(nestLines(ta.value, ...sel(), -1)),
      };
      for (const [kind] of CALLOUT_KINDS) fmt[calloutId(kind)] = () => applyEdit(insertCallout(ta.value, ...sel(), kind));
      const needEdit = (fn) => () => {
        if (mode === "read") setMode("edit");
        if (note()?.trashed) return;
        fn();
      };
      for (const [btn, fn] of [[tBold, fmt.bold], [tItalic, fmt.italic], [tStrike, fmt.strike], [tHl, fmt.highlight], [tHeading, fmt.heading], [tBullet, fmt.bullet], [tCheck, fmt.check], [tQuote, fmt.quote], [tIndent, fmt.indent], [tOutdent, fmt.outdent], [tCode, fmt.code], [tCodeBlock, fmt.codeBlock], [tNumbered, fmt.numbered], [tLink, fmt.link], [tImage, fmt.image], [tTable, fmt.table]]) {
        // mousedown must not steal the textarea selection
        listen(btn, "mousedown", (e) => e.preventDefault());
        listen(btn, "click", needEdit(fn));
      }
      listen(tMode, "click", () => setMode(mode === "read" ? "edit" : "read"));
      // Linked scrolling (split view only): the pane you scroll puts the same SOURCE line at the top of
      // the other. Each pane has its own line heights (and the editor wraps), so the position is mapped
      // line by line: editor offset <-> source line <-> rendered block, interpolated between the two
      // nearest known lines. Without layout information it falls back to the proportional position.
      // One frame of lock keeps the two scroll events from chasing each other.
      let syncLock = false;
      let rafSync = 0;
      function measureEditor() {
        const gcs = window.getComputedStyle;
        if (typeof gcs !== "function") return null;
        if (!mirror) {
          mirror = h("div", { class: "zn-mirror", "aria-hidden": "true" });
          root.append(mirror);
        }
        const cs = gcs(ta);
        for (const k of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderLeftWidth", "borderRightWidth", "whiteSpace", "overflowWrap", "wordBreak", "boxSizing"])
          mirror.style[k] = cs[k];
        mirror.style.width = ta.clientWidth + "px";
        mirror.replaceChildren();
        const lines = ta.value.split("\n");
        const rows = lines.map((l) => h("div", {}, l || "\u200b"));
        mirror.append(...rows);
        const out = rows.map((r, i) => ({ line: i, y: r.offsetTop }));
        mirror.replaceChildren();
        return mergeAnchors(out, lines.length, ta.scrollHeight);
      }
      function measureRead() {
        const base = readEl.getBoundingClientRect().top - readEl.scrollTop;
        return mergeAnchors(
          readAnch.map((a) => ({ line: a.line, y: Math.max(0, a.node.getBoundingClientRect().top - base) })),
          ta.value.split("\n").length,
          readEl.scrollHeight,
        );
      }
      const atEnd = (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      const linkScroll = (from, to) => () => {
        if (mode !== "split" || !store.meta.syncScroll || syncLock) return;
        const max = from.scrollHeight - from.clientHeight;
        if (!(max > 0)) return;
        syncLock = true;
        let target = null;
        try {
          if (from.scrollTop > 0 && !atEnd(from) && readAnch.length) {
            taAnchY = taAnchY || measureEditor();
            readAnchY = readAnchY || measureRead();
            if (taAnchY && readAnchY) {
              const fromEditor = from === ta;
              const line = mapPosition(fromEditor ? taAnchY : readAnchY, from.scrollTop, "y", "line");
              target = mapPosition(fromEditor ? readAnchY : taAnchY, line, "line", "y");
            }
          }
        } catch (_) {
          target = null;
        }
        if (target === null) target = (from.scrollTop / max) * Math.max(0, to.scrollHeight - to.clientHeight);
        to.scrollTop = target;
        if (!rafSync)
          rafSync = window.requestAnimationFrame(() => {
            rafSync = 0;
            syncLock = false;
          });
      };
      listen(ta, "scroll", linkScroll(ta, readEl));
      listen(readEl, "scroll", linkScroll(readEl, ta));
      listen(tSync, "click", () => {
        store.setMeta({ syncScroll: !store.meta.syncScroll });
        applyState();
      });
      listen(tSplit, "click", () => setMode(mode === "split" ? "edit" : "split"));
      listen(tRule, "mousedown", (e) => e.preventDefault());
      listen(tRule, "click", needEdit(fmt.rule));
      listen(tInsert, "mousedown", (e) => e.preventDefault());
      listen(tInsert, "click", () =>
        showMenu(tInsert, [
          ...CALLOUT_KINDS.filter(([k]) => !hiddenTools().has(calloutId(k))).map(([k, label]) => ({ label: "Callout: " + label, action: needEdit(fmt[calloutId(k)]) })),
          { sep: true },
          { label: "Superscript  X^2^", action: needEdit(fmt.sup), id: "sup" },
          { label: "Subscript  H~2~O", action: needEdit(fmt.sub), id: "sub" },
          { label: "Keyboard key  <kbd>", action: needEdit(fmt.kbd), id: "kbd" },
        ].filter((it) => !it.id || !hiddenTools().has(it.id))),
      );
      listen(tSettings, "click", () => askSettings());

      // ---- menus -----------------------------------------------------------------
      function closeMenu() {
        if (!menu) return;
        menu.el.remove();
        menu = null;
      }
      // Keeps a menu fully inside both the sheet and the window: it is right-aligned to its anchor,
      // shifted back in when that would cross an edge, flipped above the anchor when there is no room
      // below, and scrolls when it is taller than the space (a narrow sheet or a window edge used to
      // crop the highlight colors).
      function placeMenu(m, anchor) {
        const doc = root.ownerDocument.documentElement;
        const pos = menuPosition({
          anchor: anchor.getBoundingClientRect(),
          host: root.getBoundingClientRect(),
          viewport: { width: doc.clientWidth || Infinity, height: doc.clientHeight || Infinity },
          size: { width: m.offsetWidth || 0, height: m.offsetHeight || 0 },
        });
        if (pos.maxHeight) m.style.maxHeight = pos.maxHeight + "px";
        m.style.left = pos.left + "px";
        m.style.top = pos.top + "px";
      }
      function showMenu(anchor, items) {
        if (menu && menu.anchor === anchor) return closeMenu();
        closeMenu();
        const m = h("div", { class: "zn-menu", role: "menu" });
        for (const it of items) {
          if (it.sep) m.append(h("div", { class: "zn-sep" }));
          else if (it.swatches) {
            const row = h("div", { class: "zn-swatches" });
            for (const c of it.swatches) {
              const b = h("button", { type: "button", class: "zn-swatch", title: c, "aria-label": c });
              b.dataset.color = c;
              if (c === it.current) b.classList.add("is-on");
              b.addEventListener("click", () => {
                closeMenu();
                it.pick(c);
              });
              row.append(b);
            }
            m.append(row);
          } else {
            const b = h("button", { type: "button", class: "zn-menu-item" + (it.danger ? " is-danger" : ""), role: "menuitem" });
            if (it.icon) b.append(icon(it.icon));
            b.append(h("span", {}, it.label));
            b.addEventListener("click", () => {
              closeMenu();
              it.action();
            });
            m.append(b);
          }
        }
        m.style.visibility = "hidden";
        root.append(m);
        placeMenu(m, anchor);
        m.style.visibility = "";
        menu = { el: m, anchor };
        m.querySelector("button")?.focus({ preventScroll: true });
      }
      listen(root, "pointerdown", (e) => {
        if (menu && !menu.el.contains(e.target) && !menu.anchor.contains(e.target)) closeMenu();
      }, true);
      // Export notice: says what each format loses before anything is written.
      function closeDialog() {
        if (!dialog) return;
        dialog.remove();
        dialog = null;
      }
      // Free-text label of the note (one short line, shown beside the title and in the list, searchable).
      function askLabel() {
        const n = note();
        if (!n || n.trashed) return;
        const f = field("Label", n.label || "", "e.g. work, ideas, shopping");
        f.input.maxLength = LABEL_MAX;
        const ok = chip("Save", true);
        const clear = chip("Remove label");
        const cancel = chip("Cancel");
        openCard("Note label", f.row, h("div", { class: "zn-dialog-actions" }, cancel, clear, ok));
        const save = (v) => {
          store.setLabel(n.id, v);
          closeDialog();
          applyState();
          if (view === "list") scheduleList();
          focusEditor();
        };
        ok.addEventListener("click", () => save(f.input.value));
        clear.addEventListener("click", () => save(""));
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        f.input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save(f.input.value);
          }
        });
        f.input.focus({ preventScroll: true });
        f.input.select?.();
      }
      listen(labelEl, "click", () => askLabel());
      function askExport(format, run) {
        closeMenu();
        closeDialog();
        const info = EXPORT_FORMATS[format];
        const ok = h("button", { type: "button", class: "zn-chip is-on" }, format === "pdf" ? "Open print dialog" : "Choose where to save\u2026");
        const cancel = h("button", { type: "button", class: "zn-chip" }, "Cancel");
        const card = h(
          "div",
          { class: "zn-dialog-card", role: "alertdialog", "aria-label": "Export as " + info.label },
          h("strong", {}, "Export as " + info.label),
          h("p", {}, info.loses),
          h("div", { class: "zn-dialog-actions" }, cancel, ok),
        );
        dialog = h("div", { class: "zn-dialog" }, card);
        cancel.addEventListener("click", closeDialog);
        ok.addEventListener("click", () => {
          closeDialog();
          Promise.resolve(run()).catch((error) => console.warn("[ZentralNotes] export failed", error));
        });
        dialog.addEventListener("pointerdown", (e) => {
          if (e.target === dialog) closeDialog();
        });
        root.append(dialog);
        ok.focus({ preventScroll: true });
      }

      // ---- small dialogs: link, table, quick settings, shortcuts ---------------------------------------
      function openCard(label, ...kids) {
        closeMenu();
        closeDialog();
        const card = h("div", { class: "zn-dialog-card", role: "dialog", "aria-label": label }, h("strong", {}, label), ...kids);
        dialog = h("div", { class: "zn-dialog" }, card);
        dialog.addEventListener("pointerdown", (e) => {
          if (e.target === dialog) closeDialog();
        });
        root.append(dialog);
        return card;
      }
      const chip = (label, on = false) => h("button", { type: "button", class: "zn-chip" + (on ? " is-on" : "") }, label);
      const field = (label, value, placeholder = "") => {
        const input = h("input", { type: "text", class: "zn-field", spellcheck: "false", "aria-label": label, placeholder });
        input.value = value;
        return { input, row: h("label", { class: "zn-field-row" }, h("span", {}, label), input) };
      };
      // Fills an empty address field from the clipboard when it holds one address `accept` approves.
      // Asynchronous and best effort: a refused or empty clipboard changes nothing.
      function prefillFromClipboard(input, accept, onFill) {
        try {
          const nav = window.navigator;
          Promise.resolve(nav?.clipboard?.readText?.())
            .then((text) => {
              const found = input.value ? null : accept(text);
              if (!found || !dialog) return;
              input.value = found;
              input.select?.();
              onFill?.(found);
            })
            .catch(() => {});
        } catch (_) {}
      }
      // Link dialog: text to show + address, like the one in a forum editor. `pasted` is set when it was
      // opened by pasting an address (then "Paste as text" keeps the address as plain text).
      function askLink({ pasted = "", s: ps, e: pe } = {}) {
        if (note()?.trashed) return;
        if (mode === "read") setMode("edit");
        const [s, e] = ps === undefined ? sel() : [ps, pe];
        const selected = ta.value.slice(s, e);
        const selIsUrl = pastedLink(selected);
        const url = pasted || selIsUrl || "";
        const text = pasted ? selected || fragmentLabel(pasted) : selIsUrl ? fragmentLabel(selIsUrl) : selected;
        const t = field("Text to show", text, "Text to show");
        const a = field("Address", url, "https://");
        const ok = chip("Create link", true);
        const cancel = chip("Cancel");
        const buttons = [cancel];
        if (pasted) {
          const plain = chip("Paste as text");
          plain.addEventListener("click", () => {
            closeDialog();
            applyEdit({ start: s, end: e, text: pasted, selStart: s + pasted.length, selEnd: s + pasted.length });
          });
          buttons.push(plain);
        }
        buttons.push(ok);
        const card = openCard("Create link", t.row, a.row, h("div", { class: "zn-dialog-actions" }, ...buttons));
        const submit = () => {
          const href = safeHref(a.input.value.trim());
          if (!href) {
            a.input.dataset.bad = "true";
            a.input.focus();
            return;
          }
          closeDialog();
          applyEdit(insertLink(ta.value, s, e, t.input.value.trim() || a.input.value.trim(), a.input.value.trim()));
        };
        ok.addEventListener("click", submit);
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        for (const f of [t, a]) f.input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            submit();
          }
        });
        (text || !url ? (text ? a : t) : t).input.focus({ preventScroll: true });
        if (!url) prefillFromClipboard(a.input, pastedLink, (u) => { if (!t.input.value) t.input.value = fragmentLabel(u); });
        return card;
      }
      // Image dialog: same layout as the link dialog. The address may come from the selection or the
      // clipboard; an optional second address makes the picture a link.
      function askImage() {
        if (note()?.trashed) return;
        if (mode === "read") setMode("edit");
        const [s, e] = sel();
        const selected = ta.value.slice(s, e);
        const selUrl = pastedWebAddress(selected);
        const alt = field("Description (alt text)", selUrl ? "" : selected.replace(/\s+/g, " ").trim(), "What the picture shows");
        const src = field("Picture address", selUrl || "", "https://");
        const link = field("Link when clicked (optional)", "", "https://");
        const help = h("p", {}, "Works with the web address (http:// or https://) of a picture: png, jpg, gif, webp or svg. Local files, data: addresses and pages behind a login do not load. In read view a picture loads only when you click it.");
        const ok = chip("Insert image", true);
        const cancel = chip("Cancel");
        openCard("Insert image", help, src.row, alt.row, link.row, h("div", { class: "zn-dialog-actions" }, cancel, ok));
        const submit = () => {
          let bad = null;
          if (!safeHref(src.input.value.trim(), false)) bad = src.input;
          else if (link.input.value.trim() && !safeHref(link.input.value.trim())) bad = link.input;
          if (bad) {
            bad.dataset.bad = "true";
            bad.focus();
            return;
          }
          closeDialog();
          applyEdit(insertImageMd(ta.value, s, e, alt.input.value.trim(), src.input.value.trim(), link.input.value.trim()));
        };
        ok.addEventListener("click", submit);
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        for (const f of [src, alt, link]) f.input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            submit();
          }
        });
        src.input.focus({ preventScroll: true });
        if (!selUrl) prefillFromClipboard(src.input, pastedWebAddress);
      }
      // Code block dialog: pick the language the block is highlighted as. A selection that already is
      // a fenced block is unwrapped at once instead.
      let lastCodeLang = "";
      function askCodeBlock() {
        if (note()?.trashed) return;
        if (mode === "read") setMode("edit");
        const [s, e] = sel();
        if (/^```[\w+#.-]*\n[\s\S]*?\n?```$/.test(ta.value.slice(s, e))) return applyEdit(insertCodeBlock(ta.value, s, e));
        // A list of buttons inside the sheet, not a native <select>: its popup is a separate window, so
        // clicking an option counts as a click outside the sheet and closes it.
        let chosen = lastCodeLang;
        const list = h("div", { class: "zn-quick zn-aligns", role: "listbox", "aria-label": "Highlight as" });
        const drawLangs = () => {
          list.replaceChildren();
          for (const [v, label] of CODE_LANGS) {
            const b = chip(label, v === chosen);
            b.setAttribute("aria-pressed", v === chosen ? "true" : "false");
            b.addEventListener("click", () => {
              chosen = v;
              drawLangs();
            });
            list.append(b);
          }
        };
        drawLangs();
        const ok = chip("Insert", true);
        const cancel = chip("Cancel");
        openCard("Code block: highlight as", list, h("div", { class: "zn-dialog-actions" }, cancel, ok));
        const go = () => {
          lastCodeLang = chosen;
          closeDialog();
          applyEdit(insertCodeBlock(ta.value, s, e, chosen));
        };
        ok.addEventListener("click", go);
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        ok.focus({ preventScroll: true });
      }
      // Table creator: pick a size on the grid (or type it), choose left / centre / right per column,
      // then insert a ready table.
      function askTable() {
        if (note()?.trashed) return;
        if (mode === "read") setMode("edit");
        const [s, e] = sel();
        const GRID_COLS = 8,
          GRID_ROWS = 6;
        const HINT = "Pick the size: columns \u00d7 rows (the first row is the header).";
        const label = h("p", {}, HINT);
        const grid = h("div", { class: "zn-grid" });
        const cells = [];
        const aligns = [];
        const alignBox = h("div", { class: "zn-quick zn-aligns" });
        const cols = field("Columns", "3");
        const rows = field("Rows", "3");
        const colCount = () => clampInt(cols.input.value, 1, MAX_TABLE_COLS);
        const drawAligns = () => {
          alignBox.replaceChildren();
          for (let i = 0; i < colCount(); i++) {
            const row = h("div", { class: "zn-quick-row" }, h("span", { class: "zn-quick-label" }, "Column " + (i + 1)));
            for (const [v, text] of [["left", "Left"], ["center", "Centre"], ["right", "Right"]]) {
              const b = chip(text, aligns[i] === v);
              b.setAttribute("aria-pressed", aligns[i] === v ? "true" : "false");
              b.addEventListener("click", () => {
                aligns[i] = aligns[i] === v ? "" : v;
                drawAligns();
              });
              row.append(b);
            }
            alignBox.append(row);
          }
        };
        const insert = () => {
          const n = colCount();
          closeDialog();
          applyEdit(insertTable(ta.value, s, e, clampInt(rows.input.value, 2, MAX_TABLE_ROWS), n, aligns.slice(0, n)));
        };
        const paint = (r, c) => {
          label.textContent = r && c ? `${c} \u00d7 ${r}` : HINT;
          for (const cell of cells) cell.el.classList.toggle("is-on", cell.r <= r && cell.c <= c);
        };
        for (let r = 1; r <= GRID_ROWS; r++)
          for (let c = 1; c <= GRID_COLS; c++) {
            const el = h("button", { type: "button", class: "zn-gcell", "aria-label": `${c} columns, ${r} rows` });
            el.addEventListener("mouseover", () => paint(r, c));
            el.addEventListener("focus", () => paint(r, c));
            el.addEventListener("click", () => {
              cols.input.value = String(c);
              rows.input.value = String(r);
              drawAligns();
            });
            cells.push({ el, r, c });
            grid.append(el);
          }
        grid.style.setProperty("--cols", String(GRID_COLS));
        grid.addEventListener("mouseleave", () => paint(0, 0));
        cols.input.addEventListener("input", drawAligns);
        for (const f of [cols, rows]) f.input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            insert();
          }
        });
        const ok = chip("Insert", true);
        const cancel = chip("Cancel");
        ok.addEventListener("click", insert);
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        drawAligns();
        openCard("Insert table", label, grid, h("div", { class: "zn-field-pair" }, cols.row, rows.row), h("p", {}, "Text alignment per column (optional):"), alignBox, h("div", { class: "zn-dialog-actions" }, cancel, ok));
        cells[0].el.focus({ preventScroll: true });
      }
      // Toolbar and shortcut actions: hide the ones that are never used (each change is saved at once).
      function askTools() {
        const body = h("div", { class: "zn-quick zn-aligns" });
        const draw = () => {
          body.replaceChildren();
          const gone = hiddenTools();
          for (const [id, name] of HIDEABLE_TOOLS) {
            const shown = !gone.has(id);
            const b = chip(shown ? "Shown" : "Hidden", shown);
            b.setAttribute("aria-pressed", shown ? "true" : "false");
            b.addEventListener("click", () => {
              const g = hiddenTools();
              if (shown) g.add(id);
              else g.delete(id);
              setPref(PREF.HIDDEN_TOOLS, serializeHidden(g));
              applyState();
              draw();
            });
            body.append(h("div", { class: "zn-quick-row" }, h("span", { class: "zn-quick-label" }, name), b));
          }
        };
        draw();
        const all = chip("Show all");
        const done = chip("Done", true);
        all.addEventListener("click", () => {
          setPref(PREF.HIDDEN_TOOLS, "");
          applyState();
          draw();
        });
        done.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        openCard("Toolbar buttons and shortcuts", h("p", {}, "A hidden action has no button, no menu entry and no keyboard shortcut. Quick settings always stays."), body, h("div", { class: "zn-dialog-actions" }, all, done));
        done.focus({ preventScroll: true });
      }
      // Quick settings: the options that are changed while writing. Each change is saved at once.
      function askSettings() {
        const body = h("div", { class: "zn-quick" });
        const read = (o) => (o.meta ? store.meta[o.meta] : getPref(o.pref, o.def));
        const write = (o, v) => {
          if (o.meta) store.setMeta({ [o.meta]: v });
          else setPref(o.pref, v);
          if (o.meta) applyState();
          draw();
        };
        function draw() {
          body.replaceChildren();
          for (const o of QUICK_OPTIONS) {
            const value = read(o);
            const row = h("div", { class: "zn-quick-row" }, h("span", { class: "zn-quick-label" }, o.label));
            if (o.kind === "bool") {
              const b = chip(value ? "On" : "Off", !!value);
              b.setAttribute("aria-pressed", value ? "true" : "false");
              b.addEventListener("click", () => write(o, !value));
              row.append(b);
            } else if (o.kind === "step") {
              const minus = iconButton("x", "Smaller");
              minus.replaceChildren(h("span", {}, "\u2212"));
              const plus = iconButton("plus", "Larger");
              minus.addEventListener("click", () => write(o, stepOption(o, value, -1)));
              plus.addEventListener("click", () => write(o, stepOption(o, value, 1)));
              row.append(minus, h("span", { class: "zn-quick-value" }, `${value}${o.unit}`), plus);
            } else {
              for (const [v, text] of o.choices) {
                const b = chip(text, value === v);
                b.addEventListener("click", () => write(o, v));
                row.append(b);
              }
            }
            body.append(row);
          }
        }
        draw();
        const keys = chip("Keyboard shortcuts\u2026");
        const toolsChip = chip("Toolbar buttons\u2026");
        const done = chip("Done", true);
        keys.addEventListener("click", () => askShortcuts());
        toolsChip.addEventListener("click", () => askTools());
        done.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        openCard("Quick settings", body, h("div", { class: "zn-dialog-actions" }, toolsChip, keys, done));
        done.focus({ preventScroll: true });
      }
      // Shortcut assignment: click a shortcut, press the new keys. Backspace clears, Esc cancels.
      function askShortcuts() {
        const body = h("div", { class: "zn-quick zn-keys" });
        const note2 = h("p", { class: "zn-key-note" }, "Click a shortcut, then press the new keys (Ctrl, Alt or Cmd is required). Backspace removes it.");
        let capturing = "";
        const overrides = () => parseShortcutMap(getPref(PREF.SHORTCUTS, ""));
        const rows = [...SHORTCUT_ACTIONS.map((a) => ({ id: a.id, label: a.label, def: a.def })), { id: "@global", label: "Open or close Notes (works anywhere)", def: "Alt+Shift+N" }];
        function current(id) {
          if (id === "@global") return normalizeCombo(getPref(PREF.SHORTCUT, "Alt+Shift+N"));
          return shortcutList().find((x) => x.id === id)?.combo || "";
        }
        function apply(id, combo) {
          if (id === "@global") {
            if (combo) setPref(PREF.SHORTCUT, combo);
            return;
          }
          setPref(PREF.SHORTCUTS, JSON.stringify(assignShortcut(overrides(), id, combo)));
        }
        function draw() {
          body.replaceChildren();
          for (const r of rows) {
            const btn = h("button", { type: "button", class: "zn-chip zn-keybtn" + (capturing === r.id ? " is-on" : "") }, capturing === r.id ? "Press keys\u2026" : current(r.id) || "none");
            btn.addEventListener("click", () => {
              capturing = capturing === r.id ? "" : r.id;
              note2.textContent = "Click a shortcut, then press the new keys (Ctrl, Alt or Cmd is required). Backspace removes it.";
              draw();
              if (capturing) btn.focus({ preventScroll: true });
            });
            btn.addEventListener("keydown", (ev) => {
              if (capturing !== r.id) return;
              ev.preventDefault();
              ev.stopPropagation();
              if (ev.key === "Escape") capturing = "";
              else if (ev.key === "Backspace" || ev.key === "Delete") {
                if (r.id !== "@global") apply(r.id, "");
                capturing = "";
              } else {
                const combo = comboFromEvent(ev);
                if (!combo) return; // a lone modifier: wait for the real key
                if (!parseShortcut(combo)) {
                  note2.textContent = "That needs Ctrl, Alt or Cmd as well.";
                  return;
                }
                const taken = r.id === "@global" ? "" : findShortcutConflict(shortcutList(), r.id, combo);
                const globalCombo = normalizeCombo(getPref(PREF.SHORTCUT, "Alt+Shift+N"));
                if (taken || (r.id !== "@global" && combo === globalCombo)) {
                  note2.textContent = `${combo} is already used by ${taken ? SHORTCUT_ACTIONS.find((a) => a.id === taken).label : "the open/close shortcut"}.`;
                  return;
                }
                apply(r.id, combo);
                capturing = "";
              }
              draw();
              applyState();
            });
            const reset = h("button", { type: "button", class: "zn-chip", title: "Back to the default" }, "Reset");
            reset.hidden = r.id === "@global" ? current(r.id) === r.def : current(r.id) === r.def;
            reset.addEventListener("click", () => {
              apply(r.id, r.def);
              draw();
              applyState();
            });
            body.append(h("div", { class: "zn-quick-row" }, h("span", { class: "zn-quick-label" }, r.label), btn, reset));
          }
        }
        draw();
        const all = chip("Reset all");
        const back = chip("Back", true);
        all.addEventListener("click", () => {
          setPref(PREF.SHORTCUTS, "");
          setPref(PREF.SHORTCUT, "Alt+Shift+N");
          capturing = "";
          draw();
          applyState();
        });
        back.addEventListener("click", () => askSettings());
        openCard("Keyboard shortcuts", note2, body, h("div", { class: "zn-dialog-actions" }, all, back));
      }
      const moreItems = () => {
        const n = note();
        if (!n) return [];
        const items = [
          { icon: "save", label: "Save as Markdown\u2026", action: () => env.exportNote(n, "md") },
          { icon: "save", label: "Export as HTML\u2026", action: () => askExport("html", () => env.exportNote(n, "html")) },
          { icon: "save", label: "Export as plain text\u2026", action: () => askExport("txt", () => env.exportNote(n, "txt")) },
          { icon: "save", label: "Print / save as PDF\u2026", action: () => askExport("pdf", () => env.printNote(n)) },
          { icon: "copy", label: "Copy text", action: () => env.copyText(n.body) },
          ...(n.trashed ? [] : [{ icon: "bookmark", label: n.label ? "Edit label\u2026" : "Add label\u2026", action: () => askLabel() }]),
          { icon: "duplicate", label: "Duplicate", action: () => { const c = store.create(n.body); store.setColor(c.id, n.color); store.setLabel(c.id, n.label); openNote(c.id); } },
          { sep: true },
          { icon: "save", label: "Export all notes\u2026", action: () => env.exportAll(store.list()) },
          { icon: "save", label: "Export all as zip\u2026", action: () => askExport("zip", async () => { const k = await env.exportZip(store.list()); if (k) flash(`Zipped ${k} notes`); }) },
          { icon: "folder", label: "Import .md folder\u2026", action: async () => { const k = await env.importFolder(store); flash(k ? `Imported ${k} notes` : "Nothing imported"); if (view === "list") scheduleList(); } },
          { icon: "folder", label: "Open notes folder", action: () => env.revealFolder(store.dir) },
          { icon: "sliders", label: "Quick settings\u2026", action: () => askSettings() },
          ...(adapter.geoKey ? [{ icon: "restore", label: "Reset position and size", action: () => resetGeo() }] : []),
          { sep: true },
        ];
        if (n.trashed) {
          items.push({ icon: "restore", label: "Restore", action: () => { store.restore(n.id); applyState(); } });
          items.push({ icon: "trash", label: "Delete forever", danger: true, action: () => { const id = n.id; currentId = ""; store.deleteForever(id).then(showEditor); } });
        } else
          items.push({ icon: "trash", label: "Move to trash", danger: true, action: () => { const id = n.id; store.trash(id); currentId = ""; showEditor(); } });
        return items;
      };
      listen(btnMore, "click", () => showMenu(btnMore, moreItems()));
      listen(btnColor, "click", () => {
        const n = note();
        if (n && !n.trashed)
          showMenu(btnColor, [{ swatches: NOTE_COLORS, current: n.color, pick: (c) => { store.setColor(n.id, c); applyState(); } }]);
      });
      listen(tHlMenu, "mousedown", (e) => e.preventDefault());
      listen(tHlMenu, "click", () =>
        showMenu(tHlMenu, [{ swatches: HIGHLIGHT_COLORS, current: store.meta.highlight, pick: (c) => { store.setMeta({ highlight: c }); applyState(); needEdit(fmt.highlight)(); } }]),
      );

      // ---- events ----------------------------------------------------------------
      listen(btnClose, "click", () => close());
      listen(btnList, "click", () => (view === "list" ? showEditor() : showList()));
      listen(titleEl, "click", () => (view === "list" ? showEditor() : showList()));
      listen(btnPin, "click", () => {
        const n = note();
        if (n && !n.trashed) {
          store.setPinned(n.id, !n.pinned);
          applyState();
        }
      });
      // ---- size, window pin, geometry -------------------------------------------------------------
      const setSize = (size) => {
        store.setMeta({ size });
        applyState();
        layout();
      };
      const toggleLarger = () => setSize(store.meta.size === "peek" ? "full" : "peek");
      const toggleSpan = () => setSize(store.meta.size === "span" ? "peek" : "span");
      const toggleKeep = () => {
        store.setMeta({ pinned: store.meta.pinned === false });
        applyState();
      };
      function resetGeo() {
        const key = adapter.geoKey;
        if (!key) return;
        const g = { ...(store.meta.geo || {}) };
        delete g[key];
        store.setMeta({ geo: g, size: "peek" });
        applyState();
        layout();
        flash("Position and size reset", 2500);
      }
      // A button with a second action on a long press: the timer exists only between press and release.
      function holdButton(btn, onTap, onHold) {
        const hold = createHoldAction({
          setTimer: (fn, ms) => window.setTimeout(fn, ms),
          clearTimer: (id) => window.clearTimeout(id),
          onTap,
          onHold,
        });
        listen(btn, "pointerdown", (e) => {
          if (e.button === undefined || e.button === 0) hold.press();
        });
        listen(btn, "pointerup", () => hold.release());
        listen(btn, "pointerleave", () => hold.cancel());
        listen(btn, "click", () => hold.click());
        cleanups.push(() => hold.cancel());
        return hold;
      }
      holdButton(btnSize, toggleLarger, toggleSpan);
      holdButton(btnKeep, toggleKeep, resetGeo);

      // Drag the title bar, resize from any edge or corner. The area is measured once when the gesture
      // starts; pointer events only remember the latest position and one frame paints it. The result is
      // stored (per host: panel / standalone card) when the pointer is released.
      let gesture = null;
      let rafDrag = 0;
      let swallowClick = false;
      function hostOffset() {
        if (adapter.position !== "absolute") return { ox: 0, oy: 0 };
        const op = root.offsetParent;
        if (!op) return null;
        const r = op.getBoundingClientRect();
        return { ox: r.left + (op.clientLeft || 0), oy: r.top + (op.clientTop || 0) };
      }
      function startGesture(e, kind) {
        if (!adapter.geoKey || (e.button !== undefined && e.button !== 0)) return;
        const a = adapter.getArea({});
        const off = hostOffset();
        if (!a || !off) return;
        const b = a.bounds || a;
        const r = root.getBoundingClientRect();
        gesture = {
          kind,
          key: adapter.geoKey,
          id: e.pointerId,
          sx: e.clientX,
          sy: e.clientY,
          start: { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height },
          area: { w: b.width, h: b.height },
          ox: b.left - off.ox,
          oy: b.top - off.oy,
          active: kind !== "move",
          next: null,
          rect: null,
        };
        try {
          e.currentTarget?.setPointerCapture?.(e.pointerId);
        } catch (_) {}
        if (kind !== "move") {
          root.dataset.dragging = "true";
          e.preventDefault();
          e.stopPropagation();
        }
      }
      function paintGesture() {
        rafDrag = 0;
        const g = gesture;
        if (!g || !g.next) return;
        const { dx, dy } = g.next;
        const rect = g.kind === "move" ? moveGeo(g.start, dx, dy, g.area) : resizeGeo(g.start, g.kind, dx, dy, g.area);
        g.rect = rect;
        root.style.left = Math.round(g.ox + rect.x) + "px";
        root.style.top = Math.round(g.oy + rect.y) + "px";
        root.style.width = rect.w + "px";
        root.style.height = rect.h + "px";
        const split = rect.w >= 560 ? "side" : "stack";
        if (root.dataset.split !== split) root.dataset.split = split;
      }
      function moveEvent(e) {
        const g = gesture;
        if (!g || (e.pointerId !== undefined && g.id !== undefined && e.pointerId !== g.id)) return;
        const dx = e.clientX - g.sx,
          dy = e.clientY - g.sy;
        if (!g.active) {
          if (Math.hypot(dx, dy) < DRAG_SLOP) return;
          g.active = true;
          root.dataset.dragging = "true";
          closeMenu();
        }
        g.next = { dx, dy };
        if (!rafDrag) rafDrag = window.requestAnimationFrame(paintGesture);
      }
      function endGesture() {
        const g = gesture;
        if (!g) return;
        gesture = null;
        if (rafDrag) window.cancelAnimationFrame(rafDrag);
        rafDrag = 0;
        delete root.dataset.dragging;
        if (!g.active || !g.next) return;
        if (g.kind === "move") swallowClick = true;
        gesture = g;
        paintGesture(); // flush the last position
        gesture = null;
        taAnchY = null;
        readAnchY = null;
        if (g.rect) {
          store.setMeta({ geo: { ...(store.meta.geo || {}), [g.key]: g.rect }, size: "peek" });
          applyState();
        }
      }
      listen(head, "pointerdown", (e) => {
        const btn = e.target?.closest?.("button");
        if (btn && !btn.classList.contains("zn-title")) return;
        startGesture(e, "move");
      });
      for (const grip of root.querySelectorAll(".zn-rz"))
        listen(grip, "pointerdown", (e) => startGesture(e, grip.getAttribute("data-h")));
      listen(root, "pointermove", moveEvent);
      listen(root, "pointerup", endGesture);
      listen(root, "pointercancel", endGesture);
      listen(head, "click", (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.stopPropagation();
        e.preventDefault();
      }, true);
      listen(head, "dblclick", (e) => {
        const btn = e.target?.closest?.("button");
        if (!btn || btn.classList.contains("zn-title")) resetGeo();
      });
      cleanups.push(() => {
        if (rafDrag) window.cancelAnimationFrame(rafDrag);
      });
      listen(btnNew, "click", newNote);
      listen(chipAll, "click", () => { filter = "all"; renderList(); });
      listen(chipRecent, "click", () => { filter = "recent"; renderList(); });
      listen(chipTrash, "click", () => { filter = "trash"; renderList(); });
      listen(chipEmpty, "click", () => {
        if (chipEmpty.dataset.armed) {
          delete chipEmpty.dataset.armed;
          chipEmpty.textContent = "Empty trash";
          store.emptyTrash().then(scheduleList);
        } else {
          chipEmpty.dataset.armed = "true";
          chipEmpty.textContent = "Click again to confirm";
          window.setTimeout(() => {
            delete chipEmpty.dataset.armed;
            chipEmpty.textContent = "Empty trash";
          }, 3000);
        }
      });
      listen(search, "input", () => { query = search.value; scheduleList(); });
      listen(search, "keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          const first = listItems.querySelector(".zn-item");
          if (first) {
            e.preventDefault();
            if (e.key === "Enter") first.click();
            else first.focus();
          }
        }
      });
      listen(ta, "input", () => {
        taAnchY = null;
        readAnchY = null;
        typed = true;
        store.update(currentId, ta.value, token);
        scheduleChrome();
        if (mode === "split" && !twoWin()) schedulePreview();
      });
      // Pasting one web address: offer the "create link" dialog (text to show + address).
      listen(ta, "paste", (e) => {
        const how = getPref(PREF.PASTE_LINK, "ask");
        if (how === "off" || ta.readOnly) return;
        const text = e.clipboardData?.getData?.("text/plain") ?? "";
        const link = pastedLink(text);
        if (!link) return;
        const [s, en] = sel();
        if (how === "selection" && s === en) return;
        e.preventDefault();
        askLink({ pasted: text.trim(), s, e: en });
      });
      listen(ta, "blur", () => {
        const n = note();
        if (!typed && n && n.body !== ta.value) ta.value = n.body;
        store.flush();
      });
      listen(root, "mousedown", (e) => e.stopPropagation());
      listen(root, "keydown", (e) => {
        try {
          handleKey(e);
        } catch (error) {
          console.warn("[ZentralNotes] key handler failed", error);
        }
        e.stopPropagation();
      });

      const ACTIONS = {
        ...Object.fromEntries(["bold", "italic", "strike", "highlight", "code", "codeBlock", "link", "image", "heading", "bullet", "numbered", "check", "quote", "table", "rule", "indent", "outdent", "sup", "sub", "kbd", ...CALLOUT_KINDS.map(([k]) => calloutId(k))].map((id) => [id, () => fmt[id]()])),
        newNote: () => newNote(),
        list: () => showList(),
        mode: () => {
          if (view === "editor") setMode(mode === "read" ? "edit" : "read");
        },
        split: () => {
          if (view === "editor") setMode(mode === "split" ? "edit" : "split");
        },
        settings: () => askSettings(),
        recent: () => {
          filter = "recent";
          showList();
        },
        notePin: () => btnPin.click(),
        keepOpen: () => toggleKeep(),
        larger: () => toggleLarger(),
        span: () => toggleSpan(),
        resetGeo: () => resetGeo(),
      };
      function handleKey(e) {
        if (e.isComposing) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (key === "Escape") {
          if (dialog) closeDialog();
          else if (menu) closeMenu();
          else if (view === "list") showEditor();
          else close();
          e.preventDefault();
          return;
        }
        if (mod || e.altKey) {
          const id = matchShortcutAction(e, shortcutList());
          if (id) {
            const act = ACTIONS[id];
            const def = SHORTCUT_ACTIONS.find((a) => a.id === id);
            const editing = view === "editor" && mode !== "read" && e.target === ta;
            if (act && (!def.edit || editing)) {
              act();
              e.preventDefault();
              return;
            }
          }
        }
        if (view === "editor" && mode !== "read" && e.target === ta && key === "Enter" && !e.shiftKey && !mod && !e.altKey && ta.selectionStart === ta.selectionEnd && !ta.readOnly) {
          const edit = continueList(ta.value, ta.selectionStart);
          if (edit) {
            applyEdit(edit);
            e.preventDefault();
          }
        }
      }

      const offStore = store.on((ev) => {
        if (!isOpen || destroyed) return;
        if (ev.type === "status") return scheduleChrome();
        if (ev.type === "reset") {
          if (currentId && !store.get(currentId)) currentId = "";
          if (view === "editor") showEditor();
          else scheduleList();
          return;
        }
        if (ev.type === "remove") {
          if (ev.id === currentId) {
            currentId = "";
            if (view === "editor") showEditor();
          }
          return view === "list" ? scheduleList() : undefined;
        }
        if (ev.type === "change") {
          if (ev.id === currentId && ev.source !== token) {
            const n = note();
            if (n && document.activeElement !== ta && ta.value !== n.body) {
              const st = ta.scrollTop;
              ta.value = n.body;
              ta.scrollTop = st;
            }
            if (mode !== "edit" && view === "editor") renderRead();
            applyState();
            scheduleChrome();
          }
          if (view === "list") scheduleList();
        }
      });

      // ---- layout ------------------------------------------------------------------
      function layout() {
        rafLayout = 0;
        if (!isOpen || destroyed || root.hidden) return;
        const a = adapter.getArea({ wide: mode === "split" && !twoWin(), span: store.meta.size === "span" });
        // The second window has no place of its own when the first leaves no room beside it.
        root.style.display = companion && !a ? "none" : "";
        if (!a || a.width < 40 || a.height < 40) return;
        const size = a.fill ? "full" : store.meta.size;
        const off = hostOffset();
        if (!off) return;
        const key = adapter.geoKey || "";
        const b = a.bounds || a;
        const geo = key ? store.meta.geo?.[key] : null;
        let left, top, w, hgt;
        if (geo && size === "peek" && b.height >= 320) {
          const g = clampGeo(geo, { w: b.width, h: b.height });
          left = b.left + g.x;
          top = b.top + g.y;
          w = g.w;
          hgt = g.h;
        } else {
          const r = placeSheet({ area: a, size });
          left = a.left + r.x;
          top = a.top + r.y;
          w = r.w;
          hgt = r.h;
        }
        root.style.left = Math.round(left - off.ox) + "px";
        root.style.top = Math.round(top - off.oy) + "px";
        root.style.width = Math.round(w) + "px";
        root.style.height = Math.round(hgt) + "px";
        root.dataset.split = w >= 560 ? "side" : "stack";
        taAnchY = null;
        readAnchY = null;
        placeReveal();
        applyPush(left, w);
        comp?.layout();
      }
      // ---- push page (standalone card): the page makes room instead of being covered ---------------
      let pushed = false;
      function applyPush(left, w) {
        const want = !!adapter.push && !tucked && !companion && !!getPref(PREF.PUSH_PAGE, false) && store.meta.size === "peek";
        if (want) pushed = adapter.push({ left, width: w }) || false;
        else if (pushed || adapter.push) {
          adapter.unpush?.();
          pushed = false;
        }
      }
      // ---- hover reveal: an outside click tucks the card away; the strip on its top edge brings it back ----
      function placeReveal() {
        if (!revealEl) return;
        revealEl.style.position = adapter.position;
        revealEl.style.left = root.style.left;
        revealEl.style.top = root.style.top;
        revealEl.style.width = root.style.width;
      }
      function tuck() {
        if (tucked || !isOpen || destroyed || companion) return;
        tucked = true;
        closeMenu();
        closeDialog();
        drop();
        try {
          if (root.contains(document.activeElement)) document.activeElement.blur();
        } catch (_) {}
        root.dataset.tucked = "true";
        revealEl = h("div", { class: "zentral-notes-reveal", "aria-hidden": "true" });
        revealEl.addEventListener("mouseenter", () => {
          window.clearTimeout(revealTimer);
          revealTimer = window.setTimeout(untuck, 140);
        });
        revealEl.addEventListener("mouseleave", () => window.clearTimeout(revealTimer));
        (root.parentNode || document.documentElement).appendChild(revealEl);
        placeReveal();
        applyPush(0, 0);
        adapter.setActive(false);
        syncCompanion();
      }
      function dropReveal() {
        window.clearTimeout(revealTimer);
        revealTimer = 0;
        revealEl?.remove();
        revealEl = null;
      }
      function untuck() {
        if (!tucked) return;
        tucked = false;
        delete root.dataset.tucked;
        dropReveal();
        adapter.setActive(true);
        raise();
        syncCompanion();
        scheduleLayout();
        focusEditor();
      }
      // ---- split view as a second window -----------------------------------------------------------
      function syncCompanion() {
        const want = isOpen && !destroyed && !tucked && twoWin();
        if (want && !comp) {
          const sibling = createSheet({
            store,
            adapter: createCompanionAdapter(adapter, root, () => {
              if (!comp) return;
              const gone = comp;
              comp = null;
              peerRoot = null;
              gone.destroy();
              if (mode === "split") setMode("edit");
            }),
            env,
            ensureStore,
            companion: { parent: () => currentId },
          });
          comp = sibling;
          peerRoot = sibling.root;
          sibling.setPeer(root);
          sibling.open();
        } else if (!want && comp) {
          const gone = comp;
          comp = null;
          peerRoot = null;
          gone.destroy();
        }
      }
      const scheduleLayout = () => {
        if (!rafLayout) rafLayout = window.requestAnimationFrame(layout);
      };

      // ---- top layer (standalone card only) -------------------------------------------------------
      // Big Preview lives in the browser's top layer, which no z-index outranks. While Notes has the
      // focus the card is a manual popover shown after Big Preview, so it sits above it; when something
      // else is pressed the popover is dropped (the attribute is removed so the card stays visible as a
      // normal layer) and Big Preview is above again.
      let topLayer = false;
      function raise() {
        if (adapter.position !== "fixed" || !isOpen || destroyed || root.hidden || typeof root.showPopover !== "function") return;
        try {
          if (topLayer && root.matches(":popover-open")) root.hidePopover();
          root.setAttribute("popover", "manual");
          root.showPopover();
          topLayer = true;
        } catch (_) {
          topLayer = false;
        }
      }
      function drop() {
        if (!topLayer) return;
        topLayer = false;
        try {
          if (root.matches(":popover-open")) root.hidePopover();
        } catch (_) {}
        root.removeAttribute("popover");
      }
      const focusInside = () => root.contains(document.activeElement);
      listen(root, "pointerdown", () => {
        if (!topLayer || !focusInside()) raise();
      }, true);
      listen(root, "focusin", () => {
        if (!topLayer) raise();
      });
      // The entrance animation plays once per open; entering or leaving the top layer must not replay it.
      listen(root, "animationend", () => {
        root.dataset.settled = "true";
      });
      // A press anywhere outside the sheet: leave the top layer and, when the window is not pinned,
      // close (as the panels do). The bar's own button and the browser chrome are exempt.
      const EXEMPT_IDS = ["navigator-toolbox", "sidebar-box", "PersonalToolbar", "nav-bar", "zentral-settings-modal"];
      function isExempt(target, path) {
        if (adapter.ignoreOutside?.(target, path)) return true;
        const nodes = path && path.length ? path : [];
        for (const el of nodes) {
          if (el?.classList?.contains?.("zentral-notes-sheet") || el?.classList?.contains?.("zentral-notes-btn")) return true;
          if (el?.id && (EXEMPT_IDS.includes(el.id) || el.id.includes("sine"))) return true;
        }
        if (target?.closest) {
          for (const id of EXEMPT_IDS) if (target.closest("#" + id)) return true;
          if (target.closest(".zentral-notes-btn") || target.closest(".zentral-notes-sheet")) return true;
        }
        return false;
      }
      const onOutsidePress = (e) => {
        if (!isOpen || destroyed || gesture) return;
        const path = e.composedPath ? e.composedPath() : [];
        if (root.contains(e.target) || path.includes(root)) return;
        if (peerRoot && (peerRoot.contains(e.target) || path.includes(peerRoot))) return;
        if (tucked) return;
        drop();
        if (companion) return; // the first window decides (tuck or close) and takes this one along
        if (store.meta.pinned !== false) return;
        if (isExempt(e.target, path)) return;
        if (getPref(PREF.HOVER_REVEAL, false)) tuck();
        else close();
      };

      // ---- open / close -------------------------------------------------------------
      async function open() {
        if (destroyed) return;
        if (isOpen) {
          if (tucked) untuck();
          else focusEditor();
          return;
        }
        isOpen = true;
        adapter.attach(root);
        root.hidden = false;
        mode = companion ? "edit" : store.meta.mode;
        applyState();
        layout();
        unwatch = adapter.watch(scheduleLayout);
        window.addEventListener("mousedown", onOutsidePress, true);
        adapter.setActive(true);
        raise();
        try {
          await ensureStore();
        } catch (error) {
          console.warn("[ZentralNotes] store unavailable", error);
          statusEl.textContent = "Notes folder unavailable";
          return;
        }
        if (!isOpen || destroyed) return;
        mode = companion ? "edit" : store.meta.mode;
        store.refresh().catch(() => {});
        // The second window shows another note than the first (never the same one in two editors).
        const other = companion?.parent();
        const id = companion
          ? (store.meta.recent || []).find((x) => x !== other && store.get(x) && !store.get(x).trashed) ||
            store.list().find((n) => n.id !== other)?.id ||
            ""
          : store.latestId();
        if (id) openNote(id);
        else newNote();
        layout();
      }
      function close() {
        if (!isOpen) return;
        isOpen = false;
        syncCompanion();
        if (tucked) {
          tucked = false;
          delete root.dataset.tucked;
        }
        dropReveal();
        applyPush(0, 0);
        closeMenu();
        closeDialog();
        window.clearTimeout(previewTimer);
        previewTimer = 0;
        if (currentId) store.discardIfEmpty(currentId);
        store.flush();
        window.removeEventListener("mousedown", onOutsidePress, true);
        endGesture();
        drop();
        root.hidden = true;
        delete root.dataset.settled;
        try {
          unwatch?.();
        } catch (_) {}
        unwatch = null;
        adapter.setActive(false);
        adapter.onClosed?.();
      }
      function destroy() {
        if (destroyed) return;
        if (isOpen) close();
        destroyed = true;
        offStore();
        for (const fn of cleanups.splice(0).reverse()) {
          try {
            fn();
          } catch (_) {}
        }
        window.clearTimeout(confirmTimer);
        window.clearTimeout(previewTimer);
        window.clearTimeout(flashTimer);
        for (const id of [rafChrome, rafList, rafLayout, rafSync]) if (id) window.cancelAnimationFrame(id);
        window.removeEventListener("mousedown", onOutsidePress, true);
        root.remove();
      }
      // A read option (blank lines, line breaks, Setext) changed: draw the read pane again.
      function refreshRead() {
        if (!isOpen || destroyed || view !== "editor") return;
        resetRead();
        if (mode !== "edit") renderRead();
      }
      return {
        root,
        open,
        close,
        destroy,
        refreshRead,
        layout: scheduleLayout,
        applyState,
        focus: focusEditor,
        // A tucked card counts as closed for the button and the shortcuts: using them brings it back.
        isOpen: () => isOpen && !tucked,
        setPeer: (el) => {
          peerRoot = el;
        },
        toggle: () => (isOpen && !tucked ? close() : open()),
        newNote: () => {
          if (isOpen && !destroyed) newNote();
        },
      };
    }

    // ======================================================================
    // Host adapters: where a sheet lives and which area it covers
    // ======================================================================
    // Bars hold the Notes button. The sheet is always a child of the panel
    // slider (primary / Triple View) or of the Super Pin shell, positioned
    // over the page area of the browser that bar belongs to. It never moves
    // or reloads that browser.
    function createBarAdapter({ kind, barEl, button }) {
      const slider = () => document.getElementById("zen-app-panel-slider");
      const shell = () => barEl.closest("#bgalazka-super-panel");
      const host = () => (kind === "super" ? shell() : slider());
      function browserEl() {
        if (kind === "super")
          return shell()?.querySelector(":scope > browser") || null;
        const list = [...(slider()?.querySelectorAll(":scope > browser") || [])].filter(
          (b) => !b.hidden && b.getClientRects().length,
        );
        if (!list.length) return null;
        const slot = kind === "triple" ? "bottom" : "top";
        const bySlot = list.find((b) => b.getAttribute("data-bgalazka-triple-slot") === slot);
        return bySlot || (kind === "primary" ? list[0] : null);
      }
      let observeAll = () => {};
      return {
        position: "absolute",
        geoKey: "panel",
        get host() {
          return host();
        },
        // The button that opens this sheet must not count as an "outside" press.
        ignoreOutside: (target) => !!target && (button === target || button.contains?.(target)),
        attach(root) {
          const h2 = host();
          if (h2 && root.parentNode !== h2) h2.appendChild(root);
        },
        getArea({ span = false } = {}) {
          // Hold-to-fill: one rectangle around every visible page of the panel (both views in Triple View).
          if (span) {
            const rects = [...(slider()?.querySelectorAll(":scope > browser") || [])]
              .filter((x) => !x.hidden && x.getClientRects().length)
              .map((x) => x.getBoundingClientRect())
              .filter((r) => r.width > 40 && r.height > 40);
            if (rects.length) {
              const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top));
              const right = Math.max(...rects.map((r) => r.right)), bottom = Math.max(...rects.map((r) => r.bottom));
              return { left, top, width: right - left, height: bottom - top, anchor: "top" };
            }
          }
          const b = browserEl();
          if (b) {
            const r = b.getBoundingClientRect();
            if (r.width > 40 && r.height > 40)
              return { left: r.left, top: r.top, width: r.width, height: r.height, anchor: "top" };
          }
          const h2 = host();
          if (!h2) return null;
          const hr = h2.getBoundingClientRect(),
            br = barEl.getBoundingClientRect();
          return { left: hr.left, top: br.bottom, width: hr.width, height: hr.bottom - br.bottom, anchor: "top" };
        },
        watch(cb) {
          const ro = new ResizeObserver(cb);
          observeAll = () => {
            ro.disconnect();
            const h2 = host();
            if (h2) ro.observe(h2);
            for (const b of slider()?.querySelectorAll(":scope > browser") || []) ro.observe(b);
            const own = shell()?.querySelector(":scope > browser");
            if (own) ro.observe(own);
          };
          observeAll();
          window.addEventListener("resize", cb);
          return () => {
            ro.disconnect();
            observeAll = () => {};
            window.removeEventListener("resize", cb);
          };
        },
        rewatch: () => observeAll(),
        setActive(on) {
          button.dataset.active = on ? "true" : "false";
          button.setAttribute("aria-pressed", on ? "true" : "false");
        },
        onClosed: null,
      };
    }
    // The second window of a split view. It borrows the host of the first one and takes the first window's
    // size and the room beside it (see companionRect); it has no position of its own to drag or save.
    function createCompanionAdapter(parent, parentRoot, onClose) {
      return {
        position: parent.position,
        geoKey: "",
        get host() {
          return parent.host;
        },
        ignoreOutside: (t, path) => parent.ignoreOutside?.(t, path),
        attach: (root) => parent.attach(root),
        getArea() {
          const pr = parentRoot.getBoundingClientRect();
          const pa = parent.getArea({});
          const b = pa && (pa.bounds || pa);
          if (!b || pr.width < 40) return null;
          const r = companionRect({ x: pr.left, y: pr.top, w: pr.width, h: pr.height }, { x: b.left, y: b.top, w: b.width, h: b.height });
          return r ? { left: r.x - 6, top: r.y - 6, width: r.w + 12, height: r.h + 12, anchor: "top", fill: true } : null;
        },
        watch: (cb) => parent.watch(cb),
        rewatch: () => parent.rewatch?.(),
        setActive() {},
        onClosed: onClose,
      };
    }
    // The floating card. With `docked()` on it opens beside the Zen sidebar (on the
    // content side, whichever side the sidebar is on) instead of in the window corner.
    function createFloatingAdapter({ docked = () => false, avoidSidebar = () => false, onActive = () => {}, isTrigger = () => false } = {}) {
      const toolbox = () => document.getElementById("navigator-toolbox");
      const sidebarRect = () => {
        const sr = toolbox()?.getBoundingClientRect();
        return sr && sr.width > 20 && sr.height > 20 ? sr : null;
      };
      return {
        position: "fixed",
        host: document.documentElement,
        // Docked or floating, the card's place is remembered (docked has its own slot, so switching the dock
        // option never moves the floating card).
        get geoKey() {
          return docked() ? "dock" : "float";
        },
        ignoreOutside: (target) => isTrigger(target),
        attach(root) {
          root.dataset.host = docked() ? "dock" : "float";
          if (root.parentNode !== document.documentElement) document.documentElement.appendChild(root);
        },
        getArea({ wide = false, span = false } = {}) {
          const sr = sidebarRect();
          if (docked()) {
            if (sr) {
              const content = document.getElementById("appcontent")?.getBoundingClientRect();
              const onRight = sr.left > window.innerWidth / 2;
              const room = onRight ? sr.left : window.innerWidth - sr.right;
              const w = Math.max(240, Math.min(440, room - 8));
              return {
                left: onRight ? sr.left - w : sr.right,
                top: content && content.height > 100 ? content.top : 0,
                width: w,
                height: content && content.height > 100 ? content.height : window.innerHeight,
                anchor: "top",
                bounds: { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
              };
            }
          }
          // Standalone: keep out of the native sidebar's space and start on the opposite side (the sidebar
          // used to cover the card and catch its clicks). The whole window is the area it may be moved in.
          const vw = window.innerWidth, vh = window.innerHeight;
          let view = { left: 0, top: 0, width: vw, height: vh };
          let side = "right";
          if (avoidSidebar() && sr) {
            view = keepClear(view, [sr], vh);
            side = sideOf(sr, vw) === "right" ? "left" : "right";
          }
          if (span) return { left: view.left, top: view.top, width: view.width, height: view.height, anchor: "top", bounds: view };
          // Split view widens the card so the editor and the preview sit side by side.
          const w = Math.min(wide ? 900 : 460, view.width - 20);
          const left = side === "right" ? view.left + view.width - w - 4 : view.left + 4;
          return { left, top: 4, width: w, height: vh - 8, anchor: "bottom", bounds: view };
        },
        watch(cb) {
          const ro = new ResizeObserver(cb);
          const tb = toolbox();
          if (tb) ro.observe(tb);
          window.addEventListener("resize", cb);
          return () => {
            ro.disconnect();
            window.removeEventListener("resize", cb);
          };
        },
        rewatch() {},
        setActive: (on) => onActive(on),
        // Push page: the page area gets a margin on the card's side while the card is open. Returns true
        // when it pushed. The margin lives in one root attribute + one variable, both removed again.
        push({ left, width }) {
          const rootEl = document.documentElement;
          const area = document.getElementById("appcontent");
          if (!area) return false;
          rootEl.removeAttribute("zentral-notes-push");
          const r = area.getBoundingClientRect();
          const amount = pushAmount({ left, width }, { left: r.left, right: r.right });
          if (!amount) return false;
          rootEl.style.setProperty("--zentral-notes-push", amount.px + "px");
          rootEl.setAttribute("zentral-notes-push", amount.side);
          return true;
        },
        unpush() {
          const rootEl = document.documentElement;
          rootEl.removeAttribute("zentral-notes-push");
          rootEl.style.removeProperty("--zentral-notes-push");
        },
        onClosed: null,
      };
    }

    function parseShortcut(text) {
      const spec = { alt: false, ctrl: false, shift: false, meta: false, key: "" };
      for (const raw of String(text || "").split("+")) {
        const p = raw.trim().toLowerCase();
        if (!p) continue;
        if (p === "alt" || p === "option") spec.alt = true;
        else if (p === "ctrl" || p === "control") spec.ctrl = true;
        else if (p === "shift") spec.shift = true;
        else if (p === "meta" || p === "cmd" || p === "command" || p === "super") spec.meta = true;
        else spec.key = p;
      }
      // A bare key would hijack typing, so a modifier is mandatory.
      return spec.key && (spec.alt || spec.ctrl || spec.meta) ? spec : null;
    }
    function matchesShortcut(e, spec) {
      if (!spec || !!e.altKey !== spec.alt || !!e.ctrlKey !== spec.ctrl || !!e.shiftKey !== spec.shift || !!e.metaKey !== spec.meta)
        return false;
      const key = String(e.key || "").toLowerCase();
      return key === spec.key || (spec.key.length === 1 && (e.code === "Key" + spec.key.toUpperCase() || e.code === "Digit" + spec.key));
    }
    const isAbsolutePath = (p) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p);

    // ======================================================================
    // Real I/O, file pickers and the feature entry point
    // ======================================================================
    const realIO = {
      join: (...parts) => PathUtils.join(...parts),
      filename: (p) => PathUtils.filename(p),
      readUTF8: (p) => IOUtils.readUTF8(p),
      writeUTF8: (p, text, opts) => IOUtils.writeUTF8(p, text, opts),
      remove: (p) => IOUtils.remove(p, { ignoreAbsent: true }),
      exists: (p) => IOUtils.exists(p),
      children: (p) => IOUtils.getChildren(p),
      stat: (p) => IOUtils.stat(p),
      // Owner-only permissions where the platform supports them.
      restrict: (p) =>
        /^Win/i.test(navigator.platform || "")
          ? Promise.resolve()
          : IOUtils.setPermissions(p, 0o600, false),
    };

    function start() {
      const cleanups = [];
      const onCleanup = (fn) => cleanups.push(fn);
      let disposed = false;
      const warn = (error) => console.warn("[ZentralNotes]", error);
      const prefBool = (k, d) => {
        try {
          return Services.prefs.getBoolPref(k, d);
        } catch (_) {
          return d;
        }
      };
      const prefStr = (k, d) => {
        try {
          return Services.prefs.getStringPref(k, d);
        } catch (_) {
          return d;
        }
      };
      const prefInt = (k, d) => {
        try {
          return Services.prefs.getIntPref(k, d);
        } catch (_) {
          return d;
        }
      };
      const enabledNow = () => prefBool(PREF.ENABLED, true);
      const windowId = Math.random().toString(36).slice(2);

      // ---- store (created now, opened on first use) -------------------------
      async function resolveDir() {
        const fallback = realIO.join(PathUtils.profileDir, "zentral-notes");
        const custom = prefStr(PREF.FOLDER, "").trim();
        const wanted = custom && isAbsolutePath(custom) ? custom : fallback;
        const make = async (dir) => {
          await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
          if (!/^Win/i.test(navigator.platform || ""))
            await IOUtils.setPermissions(dir, 0o700, false).catch(() => {});
          return dir;
        };
        try {
          return await make(wanted);
        } catch (error) {
          if (wanted === fallback) throw error;
          warn("Notes folder unusable, using the profile folder: " + error);
          return make(fallback);
        }
      }
      const store = createStore({
        io: realIO,
        notify: (msg) => {
          try {
            Services.obs.notifyObservers(null, OBS_TOPIC, JSON.stringify(msg));
          } catch (_) {}
        },
        windowId,
        getDir: resolveDir,
        getMaxSaveMs: () =>
          Math.max(2, Math.min(60, prefInt(PREF.AUTOSAVE, DEFAULT_MAX_SAVE_SECONDS))) * 1000,
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (id) => window.clearTimeout(id),
        warn,
      });
      const remoteObserver = {
        observe(_subject, topic, data) {
          if (topic === OBS_TOPIC) store.onRemoteMessage(data);
        },
      };
      let storePromise = null;
      function ensureStore() {
        if (!storePromise)
          storePromise = store
            .open()
            .then(() => {
              if (!disposed) Services.obs.addObserver(remoteObserver, OBS_TOPIC);
            })
            .catch((error) => {
              storePromise = null;
              throw error;
            });
        return storePromise;
      }
      onCleanup(() => {
        try {
          Services.obs.removeObserver(remoteObserver, OBS_TOPIC);
        } catch (_) {}
      });
      const quitObserver = {
        observe() {
          store.flush();
        },
      };
      try {
        Services.obs.addObserver(quitObserver, "quit-application-granted");
        onCleanup(() => {
          try {
            Services.obs.removeObserver(quitObserver, "quit-application-granted");
          } catch (_) {}
        });
      } catch (_) {}

      // ---- environment services for sheets ------------------------------------
      const copyText = (text) => {
        try {
          Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
        } catch (error) {
          warn(error);
        }
      };
      const openLink = (url) => {
        const safe = safeHref(url);
        if (!safe) return;
        try {
          window.gBrowser.addTab(safe, {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
        } catch (error) {
          warn(error);
        }
      };
      function pick(mode, title, defaultName, format = "md") {
        return new Promise((resolve) => {
          try {
            const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
            fp.init(window.browsingContext, title, mode);
            if (defaultName) fp.defaultString = defaultName;
            if (mode === Ci.nsIFilePicker.modeSave) {
              const info = EXPORT_FORMATS[format] || EXPORT_FORMATS.md;
              fp.appendFilter(`${info.label} (*.${info.ext})`, "*." + info.ext);
              fp.appendFilters(Ci.nsIFilePicker.filterAll);
              fp.defaultExtension = info.ext;
            }
            fp.open((rv) =>
              resolve(
                rv === Ci.nsIFilePicker.returnOK || rv === Ci.nsIFilePicker.returnReplace ? fp.file : null,
              ),
            );
          } catch (error) {
            warn(error);
            resolve(null);
          }
        });
      }
      const readOpts = () => ({
        joinLines: prefStr(PREF.LINE_BREAKS, "break") === "join",
        keepBlanks: prefStr(PREF.BLANK_LINES, "collapse") === "keep",
        setext: prefBool(PREF.SETEXT, false),
      });
      // One typed accessor pair for the sheets' quick settings and shortcut editor.
      const getPref = (k, d) => (typeof d === "boolean" ? prefBool(k, d) : typeof d === "number" ? prefInt(k, d) : prefStr(k, d));
      const setPref = (k, v) => {
        try {
          if (typeof v === "boolean") Services.prefs.setBoolPref(k, v);
          else if (typeof v === "number") Services.prefs.setIntPref(k, Math.round(v));
          else Services.prefs.setStringPref(k, String(v));
        } catch (e) {
          warn(e);
        }
      };
      const withNewline = (t) => (t.endsWith("\n") ? t : t + "\n");
      async function exportNote(n, format = "md") {
        const info = EXPORT_FORMATS[format] || EXPORT_FORMATS.md;
        const file = await pick(Ci.nsIFilePicker.modeSave, "Save note", safeFileName(titleOf(n.body), "note") + "." + info.ext, format);
        if (!file) return;
        try {
          const text = format === "html" ? exportHtml(n.body, readOpts()) : format === "txt" ? exportText(n.body, readOpts()) : withNewline(n.body);
          await IOUtils.writeUTF8(file.path, text);
        } catch (error) {
          warn(error);
        }
      }
      // PDF: the note is written as a page to a temporary file and opened in a tab; the page opens
      // the print dialog itself. The temporary folder is emptied of older files on every print.
      async function printNote(n) {
        try {
          const dir = PathUtils.join(PathUtils.tempDir, "zentral-notes-print");
          await IOUtils.makeDirectory(dir, { ignoreExisting: true });
          for (const old of await IOUtils.getChildren(dir).catch(() => [])) await IOUtils.remove(old, { ignoreAbsent: true }).catch(() => {});
          const path = PathUtils.join(dir, safeFileName(titleOf(n.body), "note") + ".html");
          await IOUtils.writeUTF8(path, exportHtml(n.body, readOpts(), { print: true }));
          window.gBrowser.addTab(PathUtils.toFileURI(path), {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
        } catch (error) {
          warn(error);
        }
      }
      async function exportAll(list) {
        const folder = await pick(Ci.nsIFilePicker.modeGetFolder, "Export all notes to a folder");
        if (!folder) return;
        const names = uniqueFileNames(list);
        for (let i = 0; i < list.length; i++) {
          try {
            // An existing file is never overwritten by an export.
            await IOUtils.writeUTF8(PathUtils.join(folder.path, names[i]), withNewline(list[i].body), { mode: "create" });
          } catch (error) {
            warn(error);
          }
        }
      }
      async function exportZip(list) {
        const live = list.filter((n) => !n.trashed);
        if (!live.length) return 0;
        const file = await pick(Ci.nsIFilePicker.modeSave, "Save all notes as zip", "zentral-notes.zip", "zip");
        if (!file) return 0;
        const names = uniqueFileNames(live);
        const zw = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
        try {
          zw.open(file, 0x04 | 0x08 | 0x20); // read/write, create, truncate
          const enc = new TextEncoder();
          for (let i = 0; i < live.length; i++) {
            const bytes = enc.encode(withNewline(live[i].body));
            let bin = "";
            for (let j = 0; j < bytes.length; j += 8192) bin += String.fromCharCode(...bytes.subarray(j, j + 8192));
            const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
            stream.setData(bin, bin.length);
            zw.addEntryStream(names[i], (live[i].updated || Date.now()) * 1000, Ci.nsIZipWriter.COMPRESSION_DEFAULT, stream, false);
          }
          return live.length;
        } catch (error) {
          warn(error);
          return 0;
        } finally {
          try {
            zw.close();
          } catch (_) {}
        }
      }
      // Import: every .md file of one folder (not its subfolders) becomes a new note. Files that are
      // large, unreadable or not text are skipped; nothing in the folder is changed.
      async function importFolder(store) {
        const folder = await pick(Ci.nsIFilePicker.modeGetFolder, "Import a folder of .md files");
        if (!folder) return 0;
        let count = 0;
        try {
          const files = (await IOUtils.getChildren(folder.path)).filter((f) => /\.md$/i.test(f)).sort().slice(0, MAX_IMPORT_FILES);
          for (const f of files) {
            try {
              const info = await IOUtils.stat(f);
              if (info.type !== "regular" || info.size > MAX_IMPORT_BYTES) continue;
              const { meta, body } = parseNoteText(await IOUtils.readUTF8(f));
              if (!body.trim()) continue;
              const created = store.create(body);
              if (NOTE_COLORS.includes(meta.color)) store.setColor(created.id, meta.color);
              if (meta.label) store.setLabel(created.id, meta.label);
              count++;
            } catch (error) {
              warn(error);
            }
          }
        } catch (error) {
          warn(error);
        }
        return count;
      }
      function revealFolder(dir) {
        if (!dir) return;
        try {
          const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          f.initWithPath(dir);
          try {
            f.launch();
          } catch (_) {
            f.reveal();
          }
        } catch (error) {
          warn(error);
        }
      }
      const env = { openLink, copyText, exportNote, exportAll, exportZip, importFolder, printNote, revealFolder, readOpts, getPref, setPref };

      // ---- bindings: one per bar, plus the floating card ------------------------
      const bindings = new Map(); // bar element -> binding
      let floating = null;
      let lastUsed = null;
      // Optional dock: the card opens beside the Zen sidebar and the sidebar's bottom
      // row gets a Notes button. Missing sidebar elements simply mean no button.
      let sidebarBtn = null;
      const dockSidebarNow = () => prefBool(PREF.DOCK_SIDEBAR, false);
      function syncSidebarButton() {
        const host =
          enabledNow() && dockSidebarNow()
            ? document.getElementById("zen-sidebar-bottom-buttons")
            : null;
        if (!host) {
          sidebarBtn?.remove();
          sidebarBtn = null;
          return;
        }
        if (!sidebarBtn) {
          sidebarBtn = h("button", {
            type: "button",
            class: "zentral-notes-btn zentral-notes-sidebar-btn",
            title: "Notes",
            "aria-label": "Notes",
            "aria-pressed": floating?.isOpen() ? "true" : "false",
          });
          sidebarBtn.dataset.active = floating?.isOpen() ? "true" : "false";
          sidebarBtn.appendChild(icon("note", 14));
          sidebarBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            Promise.resolve(ensureFloating().toggle()).catch(warn);
          });
        }
        if (sidebarBtn.parentNode !== host) host.appendChild(sidebarBtn);
      }
      onCleanup(() => {
        sidebarBtn?.remove();
        sidebarBtn = null;
      });
      function createBinding({ el, kind }) {
        const button = h("button", {
          type: "button",
          class: "zentral-notes-btn" + (kind === "primary" ? " zen-toolbar-btn" : ""),
          title: "Notes",
          "aria-label": "Notes",
          "aria-pressed": "false",
        });
        button.appendChild(icon("note", 14));
        const adapter = createBarAdapter({ kind, barEl: el, button });
        let sheet = null;
        const binding = {
          el,
          kind,
          button,
          adapter,
          sheet: () => sheet,
          isOpen: () => !!sheet?.isOpen(),
          visible: () => el.isConnected && !panelsHidden() && el.getClientRects().length > 0,
          open() {
            lastUsed = binding;
            if (!sheet) sheet = createSheet({ store, adapter, env, ensureStore });
            return sheet.open();
          },
          close: () => sheet?.close(),
          toggle() {
            return binding.isOpen() ? binding.close() : binding.open();
          },
          destroy() {
            try {
              sheet?.destroy();
            } catch (_) {}
            sheet = null;
            button.remove();
          },
        };
        button.addEventListener("click", (e) => {
          e.stopPropagation();
          Promise.resolve(binding.toggle()).catch(warn);
        });
        // The bar's own drag handlers must not start from this button.
        button.addEventListener("mousedown", (e) => e.stopPropagation());
        return binding;
      }
      function discoverBars() {
        const out = [];
        const primary = document.getElementById("zen-app-panel-toolbar");
        if (primary) out.push({ el: primary, kind: "primary" });
        for (const bar of document.querySelectorAll(".bgalazka-super-bar"))
          out.push({ el: bar, kind: bar.closest("#zen-app-panel-slider") ? "triple" : "super" });
        return out;
      }
      function syncBars() {
        syncTimer = 0;
        if (disposed) return;
        syncSidebarButton();
        if (!enabledNow()) {
          for (const b of bindings.values()) b.destroy();
          bindings.clear();
          lastUsed = null; // a destroyed binding must never be picked again (it would open an untracked sheet)
          floating?.close();
          return;
        }
        const found = discoverBars();
        for (const [el, b] of [...bindings]) {
          if (!el.isConnected || !found.some((f) => f.el === el)) {
            b.destroy();
            bindings.delete(el);
            if (lastUsed === b) lastUsed = null;
          }
        }
        const show = prefBool(PREF.SHOW_BUTTON, true);
        for (const f of found) {
          let b = bindings.get(f.el);
          if (!b) {
            b = createBinding(f);
            bindings.set(f.el, b);
          }
          b.button.hidden = !show;
          if (f.el.firstElementChild !== b.button) f.el.insertBefore(b.button, f.el.firstChild);
          if (b.isOpen()) {
            b.adapter.rewatch();
            b.sheet()?.layout();
          }
        }
      }
      let syncTimer = 0;
      const scheduleSync = () => {
        if (!syncTimer && !disposed) syncTimer = window.setTimeout(syncBars, 60);
      };
      onCleanup(() => window.clearTimeout(syncTimer));

      const isOwnMutation = (records) =>
        records.every((r) =>
          [...r.addedNodes, ...r.removedNodes].every(
            (n) => n.nodeType === 1 && n.classList?.contains("zentral-notes-sheet"),
          ),
        );
      const mo = new MutationObserver((records) => {
        if (!isOwnMutation(records)) scheduleSync();
      });
      let observedSlider = null;
      let bodyObserved = false;
      function attachObservers() {
        const slider = document.getElementById("zen-app-panel-slider");
        if (slider && slider !== observedSlider) {
          observedSlider = slider;
          mo.observe(slider, { childList: true });
        }
        if (!bodyObserved && document.body) {
          bodyObserved = true;
          mo.observe(document.body, { childList: true });
        }
        return !!slider;
      }
      onCleanup(() => mo.disconnect());
      // The panel suite builds its slider after startup: retry for a while.
      let tries = 0;
      let retryTimer = 0;
      const retryTick = () => {
        retryTimer = 0;
        if (disposed) return;
        tries++;
        const ready = attachObservers();
        scheduleSync();
        if (!((ready && tries > 3) || tries > 90))
          retryTimer = window.setTimeout(retryTick, 1000);
      };
      retryTimer = window.setTimeout(retryTick, 1000);
      onCleanup(() => window.clearTimeout(retryTimer));
      attachObservers();
      syncBars();

      // ---- shortcut ----------------------------------------------------------------
      let shortcut = parseShortcut(prefStr(PREF.SHORTCUT, "Alt+Shift+N"));
      // A panel hidden by "hide when not hovered" keeps its bars in the DOM and may keep focus, but
      // the user cannot see it: the shortcut then opens the standalone (floating) sheet as if no
      // panel were open.
      function panelsHidden() {
        const r = document.documentElement;
        return r.hasAttribute("bgalazka-hover-panel-enabled") && r.hasAttribute("bgalazka-hover-panel-hidden");
      }
      function pickBinding() {
        const active = document.activeElement;
        if (active && !panelsHidden()) {
          for (const b of bindings.values()) {
            const host = b.adapter.host;
            if (b.el.contains(active) || host?.contains(active)) return b;
          }
        }
        if (lastUsed && [...bindings.values()].includes(lastUsed) && lastUsed.visible()) return lastUsed;
        const primary = [...bindings.values()].find((b) => b.kind === "primary" && b.visible());
        if (primary && document.getElementById("zen-app-panel-root")?.hasAttribute("open")) return primary;
        return ensureFloating();
      }
      function ensureFloating() {
        if (!floating) {
          const adapter = createFloatingAdapter({
            docked: () => dockSidebarNow(),
            avoidSidebar: () => prefBool(PREF.AVOID_SIDEBAR, true),
            isTrigger: (t) => !!sidebarBtn && (sidebarBtn === t || sidebarBtn.contains?.(t)),
            onActive: (on) => {
              if (sidebarBtn) {
                sidebarBtn.dataset.active = on ? "true" : "false";
                sidebarBtn.setAttribute("aria-pressed", on ? "true" : "false");
              }
            },
          });
          const sheet = createSheet({ store, adapter, env, ensureStore });
          floating = {
            adapter,
            sheet,
            isOpen: () => sheet.isOpen(),
            open: () => sheet.open(),
            close: () => sheet.close(),
            toggle: () => sheet.toggle(),
            destroy: () => sheet.destroy(),
            // Dock preference changed while open: move to the new place.
            refresh() {
              if (sheet.isOpen()) {
                sheet.root.dataset.host = dockSidebarNow() ? "dock" : "float";
                sheet.applyState?.();
                sheet.layout();
              }
            },
          };
        }
        return floating;
      }
      function toggleFromShortcut() {
        const open = [...bindings.values(), floating].filter((b) => b?.isOpen());
        if (open.length) {
          open.forEach((b) => b.close());
          return;
        }
        Promise.resolve(pickBinding().open()).catch(warn);
      }
      // Global actions (usable while Notes is closed) come from the same shortcut table as the editor ones.
      let globalCache = { raw: null, list: [] };
      function globalShortcuts() {
        const raw = prefStr(PREF.SHORTCUTS, "");
        if (globalCache.raw !== raw)
          globalCache = {
            raw,
            list: effectiveShortcuts(parseShortcutMap(raw)).filter((x) => SHORTCUT_ACTIONS.find((a) => a.id === x.id)?.global),
          };
        return globalCache.list;
      }
      const sheetOf = (b) => (typeof b.sheet === "function" ? b.sheet() : b.sheet);
      function runGlobal(id) {
        if (id === "openFloating") {
          const f = ensureFloating();
          return Promise.resolve(f.isOpen() ? f.close() : f.open());
        }
        if (id === "quickNew") {
          const b = pickBinding();
          return Promise.resolve(b.open()).then(() => sheetOf(b)?.newNote?.());
        }
      }
      const onKey = (e) => {
        if (disposed || e.repeat || e.isComposing || !enabledNow()) return;
        if (matchesShortcut(e, shortcut)) {
          e.preventDefault();
          e.stopPropagation();
          toggleFromShortcut();
          return;
        }
        if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
        const id = matchShortcutAction(e, globalShortcuts());
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          Promise.resolve(runGlobal(id)).catch(warn);
        }
      };
      window.addEventListener("keydown", onKey, true);
      onCleanup(() => window.removeEventListener("keydown", onKey, true));

      // ---- preferences -----------------------------------------------------------------
      // Typography and wrapping are CSS variables / attributes on the root element, so every open
      // sheet follows a preference change without a registry of sheets and without re-rendering.
      const rootEl = document.documentElement;
      function applyViewPrefs() {
        const size = Math.max(8, Math.min(40, prefInt(PREF.FONT_SIZE, 13)));
        const line = Math.max(100, Math.min(300, prefInt(PREF.LINE_HEIGHT, 160)));
        rootEl.style.setProperty("--zentral-notes-font-size", size + "px");
        rootEl.style.setProperty("--zentral-notes-line-height", String(line / 100));
        rootEl.setAttribute("zentral-notes-wrap", prefBool(PREF.WRAP, true) ? "on" : "off");
        rootEl.setAttribute("zentral-notes-copy", prefBool(PREF.READ_COPY, false) ? "on" : "off");
        rootEl.setAttribute("zentral-notes-theme", normalizeTheme(prefStr(PREF.THEME, "zentral")));
      }
      applyViewPrefs();
      onCleanup(() => {
        rootEl.style.removeProperty("--zentral-notes-font-size");
        rootEl.style.removeProperty("--zentral-notes-line-height");
        rootEl.removeAttribute("zentral-notes-wrap");
        rootEl.removeAttribute("zentral-notes-copy");
        rootEl.removeAttribute("zentral-notes-theme");
      });
      const prefObserver = {
        observe(_s, _t, name) {
          if (disposed) return;
          // READ_PREFS (blank lines, line breaks, Setext) are read on every render of the read view;
          // open sheets draw it again now so the change shows at once.
          if (READ_PREFS.has(name)) {
            for (const b of [...bindings.values(), floating]) b?.sheet?.()?.refreshRead?.();
            floating?.sheet?.refreshRead?.();
          } else if (VIEW_PREFS.has(name)) applyViewPrefs();
          else if (name === PREF.SHORTCUT) shortcut = parseShortcut(prefStr(PREF.SHORTCUT, "Alt+Shift+N"));
          else if (WINDOW_PREFS.has(name)) {
            // Hover reveal, push page, split windows and the sidebar option: open sheets follow at once.
            for (const b of [...bindings.values(), floating]) {
              const sh = typeof b?.sheet === "function" ? b.sheet() : b?.sheet;
              sh?.applyState?.();
              sh?.layout?.();
            }
          }
          else if (name === PREF.FOLDER) {
            if (storePromise)
              store
                .switchDir()
                .catch(warn);
          } else if (name === PREF.ENABLED || name === PREF.SHOW_BUTTON) {
            attachObservers();
            syncBars();
            if (name === PREF.ENABLED) enabledNow() ? claimWidget() : releaseWidget();
          } else if (name === PREF.DOCK_SIDEBAR) {
            syncSidebarButton();
            floating?.refresh();
          }
        },
      };
      Services.prefs.addObserver("zen.workspace.zentral.notes.", prefObserver);
      onCleanup(() => {
        try {
          Services.prefs.removeObserver("zen.workspace.zentral.notes.", prefObserver);
        } catch (_) {}
      });

      // ---- "Customize toolbar" button ------------------------------------------------------------------
      // One shared widget definition per application. Its callbacks live in the window that created it, so
      // that window owns it and hands it over when it closes (a closed window's functions must not stay
      // registered). The click is routed to the window the button was pressed in.
      function getCUI() {
        try {
          return globalThis.CustomizableUI || ChromeUtils.importESModule("resource:///modules/CustomizableUI.sys.mjs").CustomizableUI;
        } catch (_) {
          return null;
        }
      }
      const iconUrl = () =>
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="context-stroke" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS.note}"/></svg>`,
        );
      // The icon is an SVG that takes its colours from the button (context-stroke), which only works when the
      // element opts in with -moz-context-properties. A rule in the window covers the toolbar button and the
      // copy in the Customize palette alike (an inline style on one node did neither after a restart).
      function iconStyle(doc) {
        try {
          if (!doc || doc.getElementById("zentral-notes-toolbar-style")) return;
          const st = doc.createElement("style");
          st.id = "zentral-notes-toolbar-style";
          st.textContent = `#${TOOLBAR_WIDGET_ID}{list-style-image:url("${iconUrl()}");-moz-context-properties:fill,stroke;fill:none;stroke:currentColor}`;
          (doc.head || doc.documentElement).appendChild(st);
        } catch (_) {}
      }
      function claimWidget() {
        const cui = getCUI();
        if (!cui || disposed || !enabledNow()) return;
        iconStyle(document); // every window needs the icon rule, not only the owner of the widget
        if (cui.__zentralNotesOwner === windowId) return;
        try {
          if (cui.getWidget?.(TOOLBAR_WIDGET_ID)?.provider) cui.destroyWidget(TOOLBAR_WIDGET_ID);
          cui.createWidget({
            id: TOOLBAR_WIDGET_ID,
            type: "button",
            label: "Notes",
            tooltiptext: "Notes",
            localized: false,
            onCreated(node) {
              iconStyle(node.ownerDocument);
            },
            onCommand(event) {
              const w = event?.target?.ownerGlobal;
              (w?.__zentralNotesToggle || window.__zentralNotesToggle)?.();
            },
          });
          cui.__zentralNotesOwner = windowId;
          // A widget registered after startup is not put back where the user placed it until customize mode
          // runs; place it in every open window now.
          try {
            for (const w of Services.wm.getEnumerator("navigator:browser")) {
              iconStyle(w.document);
              try {
                cui.ensureWidgetPlacedInWindow?.(TOOLBAR_WIDGET_ID, w);
              } catch (_) {}
            }
          } catch (_) {}
        } catch (error) {
          warn(error);
        }
      }
      function releaseWidget() {
        const cui = getCUI();
        if (!cui || cui.__zentralNotesOwner !== windowId) return;
        try {
          cui.destroyWidget(TOOLBAR_WIDGET_ID);
        } catch (_) {}
        cui.__zentralNotesOwner = null;
        try {
          for (const w of Services.wm.getEnumerator("navigator:browser")) if (w !== window && w.__zentralNotesClaimWidget) return w.__zentralNotesClaimWidget();
        } catch (_) {}
      }
      window.__zentralNotesToggle = () => {
        if (!disposed && enabledNow()) toggleFromShortcut();
      };
      window.__zentralNotesClaimWidget = claimWidget;
      claimWidget();
      onCleanup(() => {
        releaseWidget();
        try {
          document.getElementById("zentral-notes-toolbar-style")?.remove();
        } catch (_) {}
        delete window.__zentralNotesToggle;
        delete window.__zentralNotesClaimWidget;
      });

      const api = {
        destroy() {
          if (disposed) return;
          disposed = true;
          const closing = store.close().catch(() => {});
          for (const b of bindings.values()) b.destroy();
          bindings.clear();
          floating?.destroy();
          for (const fn of cleanups.splice(0).reverse()) {
            try {
              fn();
            } catch (_) {}
          }
          return closing;
        },
        toggle: toggleFromShortcut,
      };
      window.addEventListener("unload", () => api.destroy(), { once: true });
      return () => api.destroy();
    }

    if (ZentralRuntime) ZentralRuntime.register({ id: "notes", init: start });
    else standaloneReady(start);
  })();
})();
