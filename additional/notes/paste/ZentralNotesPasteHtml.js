/*
 * ZENTRAL FILE GUIDE - additional/notes/paste/ZentralNotesPasteHtml.js
 *
 * Purpose: Turns the rich HTML that a browser puts on the clipboard (web pages, AI chat answers) into clean Markdown for
 *   the Notes editor (roadmap T1.4). Pure logic: no DOM, no preference, no clock, no network.
 * Interaction / execution: ZentralNotes.uc.js calls htmlToMarkdown(html) from the editor's paste event. A null result means
 *   "leave the paste alone" (nothing usable, too big, or the clipboard holds no structure worth converting) and the
 *   browser pastes plain text as before. Shift+Ctrl+V (paste as plain text) never carries text/html, so it bypasses this.
 * Ownership / failure: the HTML is tokenised by hand and never reaches the chrome document. Only a fixed allow-list of
 *   tags is understood; every attribute except href / src / alt / title / class / start / checked / open / colspan is
 *   ignored; <script>, <style>, <iframe>, <object>, <embed>, <svg>, <button>, <form>, <video> and friends are dropped with their
 *   content; links and images keep only http(s) (links also mailto) addresses. The only raw HTML written into the result is
 *   <kbd>, <br> (inside table cells), <details> and <summary>, the tags the Notes renderer itself understands.
 * Registration: notes-paste-html
 * Loaded/created by: additional/notes/ZentralNotes.uc.js
 *
 * LIMITS: input over MAX_HTML characters, trees deeper than MAX_DEPTH (flattened), tables beyond 12 columns x 200 rows
 *   (cut, `lossy` is set) and lists nested deeper than 8 levels (flattened) keep the result bounded.
 */
(function () {
  "use strict";
  const MAX_HTML = 2000000, MAX_DEPTH = 120, MAX_TABLE_COLS = 12, MAX_TABLE_ROWS = 200, MAX_LIST_DEPTH = 8, MAX_OUT = 1000000;
  const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"]);
  const DROP = new Set(["script", "style", "head", "title", "iframe", "object", "embed", "svg", "noscript", "template", "button", "select", "textarea", "nav", "form", "canvas", "audio", "video", "link", "meta", "dialog", "option", "optgroup", "datalist", "frame", "frameset", "applet", "base", "source", "track"]);
  const BLOCK = new Set(["p", "div", "section", "article", "main", "header", "footer", "aside", "blockquote", "pre", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "details", "summary", "figure", "figcaption", "dl", "dt", "dd", "address", "fieldset", "center", "body", "html"]);
  const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®", trade: "™", times: "×", divide: "÷", middot: "·", bull: "•", laquo: "«", raquo: "»", euro: "€", pound: "£", yen: "¥", cent: "¢", deg: "°", plusmn: "±", larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", check: "✓", zwj: "", zwnj: "", shy: "" };

  function decode(s) {
    return String(s).replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,8}));/g, (m, dec, hex, name) => {
      if (name) return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : m;
      const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "";
      if (cp < 32 && cp !== 9 && cp !== 10) return "";
      return String.fromCodePoint(cp);
    });
  }

  const ATTR_KEEP = new Set(["href", "src", "alt", "title", "class", "start", "checked", "open", "colspan", "type", "encoding", "aria-hidden"]);
  function parseAttrs(src) {
    const out = {};
    const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (let m, n = 0; (m = re.exec(src)) && n < 40; n++) {
      const k = m[1].toLowerCase();
      if (!ATTR_KEEP.has(k) || k in out) continue;
      out[k] = decode(m[2] ?? m[3] ?? m[4] ?? "");
    }
    return out;
  }

  // Tolerant tree builder. Unknown closing tags are ignored, implied end tags (li, p, tr, td, th, dt, dd) are honoured.
  function parseHtml(html) {
    const root = { tag: "#root", attrs: {}, kids: [] };
    const stack = [root];
    const top = () => stack[stack.length - 1];
    const push = (node) => { top().kids.push(node); };
    const closeTo = (names) => {
      for (let i = stack.length - 1; i > 0; i--) {
        if (names.includes(stack[i].tag)) { stack.length = i; return true; }
        if (["ul", "ol", "table", "details", "blockquote"].includes(stack[i].tag)) return false;
      }
      return false;
    };
    const re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\?[^>]*>|<\/([A-Za-z][A-Za-z0-9:-]*)\s*>|<([A-Za-z][A-Za-z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;
    let last = 0, m, dropDepth = 0, dropTag = "";
    const text = (s) => { if (s && !dropDepth) push({ text: s }); };
    while ((m = re.exec(html))) {
      text(decode(html.slice(last, m.index)));
      last = re.lastIndex;
      if (m[1]) {
        const tag = m[1].toLowerCase();
        if (dropDepth) { if (tag === dropTag && --dropDepth === 0) dropTag = ""; continue; }
        if (tag === "br" || VOID.has(tag)) continue;
        const idx = stack.map((n) => n.tag).lastIndexOf(tag);
        if (idx > 0) stack.length = idx;
        continue;
      }
      if (!m[2]) continue;
      const tag = m[2].toLowerCase();
      if (dropDepth) { if (tag === dropTag && !m[4] && !VOID.has(tag)) dropDepth++; continue; }
      if (DROP.has(tag)) { if (!m[4] && !VOID.has(tag)) { dropTag = tag; dropDepth = 1; } continue; }
      if (tag === "li") closeTo(["li"]);
      else if (tag === "p") closeTo(["p"]);
      else if (tag === "tr") closeTo(["tr"]);
      else if (tag === "td" || tag === "th") closeTo(["td", "th"]);
      else if (tag === "dt" || tag === "dd") closeTo(["dt", "dd"]);
      const node = { tag, attrs: parseAttrs(m[3] || ""), kids: [] };
      push(node);
      if (!m[4] && !VOID.has(tag) && stack.length < MAX_DEPTH) stack.push(node);
    }
    text(decode(html.slice(last)));
    return root;
  }

  const classes = (n) => String(n.attrs.class || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hasClass = (n, c) => classes(n).includes(c);
  function plain(n) {
    if (n.text !== undefined) return n.text;
    if (n.tag === "br") return "\n";
    return n.kids.map(plain).join("");
  }
  function find(n, pred) {
    if (n.text !== undefined) return null;
    if (pred(n)) return n;
    for (const k of n.kids) { const r = find(k, pred); if (r) return r; }
    return null;
  }

  function safeUrl(raw, mail) {
    const u = String(raw || "").replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]+/g, "");
    if (!u || u.length > 2000) return "";
    if (/^https?:\/\/[^/?#]/i.test(u)) return u.replace(/[()<>"\\]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
    if (mail && /^mailto:[^\s@]+@[^\s@]+$/i.test(u)) return u.replace(/[()<>"\\]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
    return "";
  }

  // Characters of plain text that Markdown (or the Notes flavors) would read as syntax get a backslash (all of them are
  // in the Notes escape set). Line-start markers are handled by escapeLines once a paragraph is complete.
  function esc(s, ctx) {
    let t = s.replace(/\\/g, "\\\\").replace(/([*`[\]~^])/g, "\\$1").replace(/(^|[^A-Za-z0-9])_|_(?=[^A-Za-z0-9]|$)/g, (m) => m.replace("_", "\\_"));
    if ((t.match(/\$/g) || []).length >= 2) t = t.replace(/\$/g, "\\$");
    t = t.replace(/==/g, "\\=\\=").replace(/\|\|/g, "\\|\\|").replace(/<(?=[A-Za-z/!])/g, "\\<");
    if (ctx.cell) t = t.replace(/\|/g, "\\|");
    return t;
  }
  function escapeLines(text) {
    return text.split("\n").map((line) => line
      .replace(/^(\s*)(#{1,6})(\s|$)/, "$1\\$2$3")
      .replace(/^(\s*)([>+-])(\s)/, "$1\\$2$3")
      .replace(/^(\s*)(\d{1,9})([.)])(\s)/, "$1$2\\$3$4")
      .replace(/^(\s*)(---+|===+|___+)\s*$/, (m, a, b) => a + "\\" + b)).join("\n");
  }

  function fenceFor(content, ch) {
    const runs = content.match(new RegExp(ch + "+", "g")) || [];
    return ch.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
  }
  function codeSpan(raw) {
    const content = raw.replace(/\s+/g, " ").trim();
    if (!content) return "";
    const runs = content.match(/`+/g) || [];
    const tick = "`".repeat(runs.length ? Math.max(...runs.map((r) => r.length)) + 1 : 1);
    return tick + (/^`|`$/.test(content) ? " " + content + " " : content) + tick;
  }
  function wrapMark(inner, mark) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    if (!m[2]) return inner;
    return m[1] + mark + m[2] + mark + m[3];
  }

  function inlineList(nodes, ctx) {
    let out = "";
    for (const n of nodes) out += inlineNode(n, ctx);
    return out;
  }
  function inlineNode(n, ctx) {
    if (n.text !== undefined) {
      if (ctx.pre) return n.text;
      return esc(n.text.replace(/[\u00a0\u2007\u202f]/g, " ").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " "), ctx);
    }
    const tag = n.tag;
    if (hasClass(n, "katex-display") || (hasClass(n, "katex") && !ctx.inKatex) || hasClass(n, "math-display")) {
      const ann = find(n, (k) => k.tag === "annotation" && /tex/i.test(k.attrs.encoding || ""));
      const tex = ann ? plain(ann).trim() : "";
      if (tex && tex.length < 2000 && !/[\n]/.test(tex.trim()) ) return hasClass(n, "katex-display") ? "\n\n$$\n" + tex + "\n$$\n\n" : "$" + tex.replace(/\$/g, "\\$") + "$";
      if (tex) return "\n\n$$\n" + tex + "\n$$\n\n";
      if (hasClass(n, "katex-html")) return "";
    }
    if (hasClass(n, "katex-html") || n.attrs["aria-hidden"] === "true" && hasClass(n, "katex-html")) return "";
    switch (tag) {
      case "br": return ctx.cell ? "<br>" : "\u0001\n";
      case "wbr": case "annotation": case "annotation-xml": return "";
      case "math": {
        const ann = find(n, (k) => k.tag === "annotation" && /tex/i.test(k.attrs.encoding || ""));
        const tex = ann ? plain(ann).trim() : "";
        return tex && tex.length < 2000 && !/\n/.test(tex) ? "$" + tex.replace(/\$/g, "\\$") + "$" : esc(plain(n).replace(/\s+/g, " "), ctx);
      }
      case "b": case "strong": return ctx.bold ? inlineList(n.kids, ctx) : wrapMark(inlineList(n.kids, { ...ctx, bold: true }), "**");
      case "i": case "em": case "cite": case "dfn": case "var": return ctx.italic ? inlineList(n.kids, ctx) : wrapMark(inlineList(n.kids, { ...ctx, italic: true }), "*");
      case "s": case "del": case "strike": return ctx.strike ? inlineList(n.kids, ctx) : wrapMark(inlineList(n.kids, { ...ctx, strike: true }), "~~");
      case "mark": return wrapMark(inlineList(n.kids, ctx), "==");
      case "u": case "ins": return inlineList(n.kids, ctx);
      case "sub": { const t = plain(n).trim(); return t && !/\s/.test(t) && t.length <= 40 ? "~" + esc(t, ctx).replace(/\\~/g, "") + "~" : esc(t ? " " + t : "", ctx); }
      case "sup": { const t = plain(n).trim(); return t && !/\s/.test(t) && t.length <= 40 ? "^" + esc(t, ctx).replace(/\\\^/g, "") + "^" : esc(t ? " " + t : "", ctx); }
      case "kbd": { const t = plain(n).replace(/\s+/g, " ").trim(); return t ? "<kbd>" + t.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]) + "</kbd>" : ""; }
      case "code": case "samp": case "tt": return ctx.code ? plain(n) : codeSpan(plain(n));
      case "a": {
        const href = safeUrl(n.attrs.href, true);
        const inner = inlineList(n.kids, ctx);
        if (!href || !inner.trim()) return inner;
        const title = n.attrs.title ? ' "' + n.attrs.title.replace(/["\n\r]+/g, " ").slice(0, 200).trim() + '"' : "";
        return "[" + noBreak(inner).replace(/\n+/g, " ").trim() + "](" + href + title + ")";
      }
      case "img": {
        const src = safeUrl(n.attrs.src, false);
        const alt = (n.attrs.alt || "").replace(/[\[\]\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
        if (!src) return alt ? esc(alt, ctx) : "";
        const title = n.attrs.title ? ' "' + n.attrs.title.replace(/["\n\r]+/g, " ").slice(0, 200).trim() + '"' : "";
        return "![" + alt + "](" + src + title + ")";
      }
      case "input":
        return (n.attrs.type || "").toLowerCase() === "checkbox" ? ("checked" in n.attrs ? "[x] " : "[ ] ") : "";
      default:
        if (BLOCK.has(tag)) return "\n\n" + blocks([n], ctx).join("\n\n") + "\n\n";
        return inlineList(n.kids, ctx);
    }
  }

  // A hard line break is written as the sentinel \u0001 + newline while converting, so trailing-space cleanup cannot eat it.
  const noBreak = (s) => s.replace(/\u0001/g, "");
  function tidyInline(s) {
    const t = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^(?:\s|\u0001)+|(?:\s|\u0001)+$/g, "");
    return escapeLines(t.replace(/\u0001\n/g, "  \n").replace(/\u0001/g, ""));
  }
  const indent = (s, pad) => s.split("\n").map((l) => (l ? pad + l : l)).join("\n");

  function listBlock(n, ctx, depth) {
    const ordered = n.tag === "ol";
    let num = ordered ? Math.max(0, Math.min(999999, parseInt(n.attrs.start, 10) || 1)) : 0;
    const items = [];
    const nested = depth >= MAX_LIST_DEPTH;
    for (const li of n.kids) {
      if (li.text !== undefined) { if (li.text.trim()) items.push({ parts: [esc(li.text.trim(), ctx)], task: "" }); continue; }
      if (li.tag !== "li") { const r = blocks([li], ctx, depth); if (r.length) items.push({ parts: r, task: "" }); continue; }
      let task = "";
      const first = li.kids.find((k) => k.text === undefined || k.text.trim());
      const box = first && first.tag === "input" && (first.attrs.type || "").toLowerCase() === "checkbox" ? first : null;
      if (box) task = "checked" in box.attrs ? "[x] " : "[ ] ";
      const parts = blocks(li.kids.filter((k) => k !== box), { ...ctx, task: false }, depth + 1);
      if (parts.length) items.push({ parts, task });
    }
    const lines = [];
    let loose = false;
    for (const it of items) if (it.parts.length > 1 && it.parts.slice(1).some((p) => !/^(\s*)([-*+]|\d+[.)])\s/.test(p) && !p.startsWith("```"))) loose = true;
    for (const it of items) {
      const marker = ordered ? (num++) + ". " : "- ";
      const pad = " ".repeat(marker.length);
      const head = marker + it.task;
      const body = it.parts.join(loose ? "\n\n" : "\n");
      lines.push(head + indent(body, pad).replace(/^\s+/, ""));
    }
    if (nested) return [lines.join("\n")];
    return [lines.join(loose ? "\n\n" : "\n")];
  }

  function tableBlock(n, ctx, state) {
    const rows = [];
    const collect = (node) => {
      for (const k of node.kids) {
        if (k.text !== undefined) continue;
        if (k.tag === "tr") rows.push(k);
        else if (["thead", "tbody", "tfoot"].includes(k.tag)) collect(k);
      }
    };
    collect(n);
    if (!rows.length) return [];
    const grid = [];
    let head = rows.length > 0 && rows[0].kids.some((c) => c.tag === "th");
    for (const r of rows.slice(0, MAX_TABLE_ROWS + 1)) {
      const cells = [];
      for (const c of r.kids) {
        if (c.text !== undefined || (c.tag !== "td" && c.tag !== "th")) continue;
        const raw = noBreak(inlineList(c.kids, { ...ctx, cell: true }));
        const t = raw.replace(/\s*\n\s*/g, "<br>").replace(/(?:<br>\s*)+$/g, "").replace(/^\s*(?:<br>\s*)+/g, "").replace(/(?:<br>){2,}/g, "<br>").trim();
        cells.push(t);
        const span = Math.min(MAX_TABLE_COLS, Math.max(1, parseInt(c.attrs.colspan, 10) || 1));
        for (let i = 1; i < span; i++) cells.push("");
      }
      if (cells.length) grid.push(cells);
    }
    if (!grid.length) return [];
    if (rows.length > MAX_TABLE_ROWS + 1) state.lossy = true;
    let cols = Math.max(...grid.map((r) => r.length));
    if (cols > MAX_TABLE_COLS) { cols = MAX_TABLE_COLS; state.lossy = true; }
    const row = (r) => "| " + Array.from({ length: cols }, (_, i) => r[i] || " ").map((c) => c.trim() || " ").join(" | ") + " |";
    const header = head ? grid[0] : Array.from({ length: cols }, () => "");
    const body = head ? grid.slice(1) : grid;
    return [[row(header), "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |", ...body.map(row)].join("\n")];
  }

  function codeBlock(n) {
    const code = find(n, (k) => k.tag === "code");
    const host = code || n;
    const cls = classes(host).concat(classes(n));
    let lang = "";
    for (const c of cls) { const m = /^(?:language|lang|highlight-source|brush:?)-?([a-z0-9#+_.-]{1,20})$/.exec(c); if (m && m[1] !== "plaintext" && m[1] !== "text") { lang = m[1]; break; } }
    // Chat UIs put a toolbar ("Copy code") in front of the code; the real text sits in the <code> element.
    let text = plain(code || n).replace(/\u00a0/g, " ").replace(/\n+$/g, "").replace(/^\n+/g, "");
    if (!text.trim()) return [];
    const fence = fenceFor(text, "`");
    return [fence + lang + "\n" + text + "\n" + fence];
  }

  function blocks(nodes, ctx, depth = 0, state = ctx.state || (ctx.state = { lossy: false })) {
    const out = [];
    let buf = "";
    const flush = () => {
      const t = tidyInline(buf);
      buf = "";
      if (t) out.push(t);
    };
    for (const n of nodes) {
      if (n.text !== undefined || !BLOCK.has(n.tag)) {
        if (n.text === undefined && (hasClass(n, "katex-display") || hasClass(n, "math-display"))) { buf += inlineNode(n, ctx); continue; }
        buf += inlineNode(n, ctx);
        continue;
      }
      switch (n.tag) {
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
          flush();
          const t = noBreak(inlineList(n.kids, ctx)).replace(/\s*\n\s*/g, " ").trim();
          if (t) out.push("#".repeat(Number(n.tag[1])) + " " + t);
          break;
        }
        case "hr": flush(); out.push("---"); break;
        case "pre": flush(); out.push(...codeBlock(n)); break;
        case "ul": case "ol": flush(); out.push(...listBlock(n, ctx, depth)); break;
        case "table": flush(); out.push(...tableBlock(n, ctx, state)); break;
        case "blockquote": {
          flush();
          const inner = blocks(n.kids, ctx, depth, state).join("\n\n");
          if (inner) out.push(inner.split("\n").map((l) => (l ? "> " + l : ">")).join("\n"));
          break;
        }
        case "details": {
          flush();
          const sum = n.kids.find((k) => k.tag === "summary");
          const rest = n.kids.filter((k) => k !== sum);
          const title = sum ? noBreak(inlineList(sum.kids, ctx)).replace(/\s*\n\s*/g, " ").replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;")).trim() : "";
          const inner = blocks(rest, ctx, depth, state).join("\n\n");
          out.push("<details" + ("open" in n.attrs ? " open" : "") + ">" + (title ? "\n<summary>" + title + "</summary>" : "") + (inner ? "\n\n" + inner : "") + "\n\n</details>");
          break;
        }
        case "summary": flush(); { const t = noBreak(inlineList(n.kids, ctx)).trim(); if (t) out.push("**" + t + "**"); } break;
        case "dl": flush(); out.push(...blocks(n.kids, ctx, depth, state)); break;
        case "dt": flush(); { const t = noBreak(inlineList(n.kids, ctx)).trim(); if (t) out.push(wrapMark(t, "**")); } break;
        case "dd": flush(); out.push(...blocks(n.kids, ctx, depth, state)); break;
        case "li": flush(); out.push(...listBlock({ tag: "ul", attrs: {}, kids: [n] }, ctx, depth)); break;
        case "tr": case "thead": case "tbody": case "tfoot": flush(); out.push(...tableBlock({ kids: n.tag === "tr" ? [n] : [n] }, ctx, state)); break;
        case "div": case "p": case "section": case "article": case "main": case "header": case "footer": case "aside": case "figure": case "figcaption": case "address": case "fieldset": case "center": case "body": case "html": default:
          flush();
          out.push(...blocks(n.kids, ctx, depth, state));
      }
    }
    flush();
    return out;
  }

  /** htmlToMarkdown(html) -> { markdown, lossy, structured } | null. `structured` is false when the result is only
   *  plain paragraphs (the caller then keeps the browser's own plain-text paste). */
  function htmlToMarkdown(html, opts = {}) {
    if (typeof html !== "string" || !html.trim() || html.length > (opts.maxHtml || MAX_HTML)) return null;
    let src = html.replace(/\r\n?/g, "\n");
    const start = src.search(/<!--\s*StartFragment\s*-->/i), end = src.search(/<!--\s*EndFragment\s*-->/i);
    if (start >= 0 && end > start) src = src.slice(start, end);
    let md;
    const ctx = { state: { lossy: false } };
    try {
      md = blocks(parseHtml(src).kids, ctx).join("\n\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\s+$/g, "");
    } catch (_) {
      return null;
    }
    if (!md.trim()) return null;
    if (md.length > MAX_OUT) { md = md.slice(0, MAX_OUT); ctx.state.lossy = true; }
    const structured = /^(#{1,6} |>|[-*+] |\d+\. |```|\||<details|---$)/m.test(md) || /\*\*|~~|==|\[[^\]\n]+\]\(|!\[|`|<kbd>|\$/.test(md) || /\n\n/.test(md);
    return { markdown: md, lossy: !!ctx.state.lossy, structured };
  }

  const api = { htmlToMarkdown, parseHtml, decode, safeUrl, MAX_HTML };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.ZentralModuleLoader?.define) window.ZentralModuleLoader.define("notes-paste-html", () => api);
})();
