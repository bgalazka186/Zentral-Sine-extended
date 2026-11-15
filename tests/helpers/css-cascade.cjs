"use strict";
/* A small cascade for style tests: which declaration of a style sheet wins for one element of the fake DOM
   (tests/helpers/fake-dom.cjs). It answers "what does the style sheet say this element is", so a test can assert on
   the outcome instead of on the text of one rule. A second rule with the same selector further down the file, or a
   more specific rule elsewhere, changes the answer here exactly as it does in the browser.

   What it does: comments, @media / @supports / @container blocks (their rules are kept apart, see `conditional`),
   selector lists, the descendant and child combinators, type / class / id / attribute selectors, :root, :not(),
   :is(), :where(), :first-child, :last-child, :only-child, specificity, source order, !important, and the
   shorthands `flex`, `flex-flow`, `overflow` and `gap` (so a later `flex-wrap` or `flex-basis` meets the right value).

   What it does not do: layout, inheritance, inline styles, other shorthands, sibling combinators and :has() (such a
   selector never matches; `parseCss(...).unsupported` lists them), states (:hover, :focus, ... never match) and
   pseudo-elements (a ::before rule styles another box, so it never matches the element). */

const STATE_PSEUDOS = new Set(["hover", "focus", "focus-visible", "focus-within", "active", "disabled", "enabled", "checked", "indeterminate", "placeholder-shown", "empty", "target", "visited", "link", "any-link", "invalid", "valid", "required", "optional", "read-only", "read-write", "open", "popover-open", "fullscreen", "-moz-focusring", "-moz-window-inactive", "-moz-drag-over", "-moz-native-anonymous"]);

// Index of the bracket that closes the one at `open`, or -1.
function closing(text, open, a, b) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") { i = text.indexOf(ch, i + 1); if (i < 0) return -1; continue; }
    if (ch === a) depth++;
    else if (ch === b && --depth === 0) return i;
  }
  return -1;
}
// Split at `sep` outside brackets, parentheses and quotes.
function splitTop(text, sep) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") { const j = text.indexOf(ch, i + 1); if (j < 0) break; i = j; continue; }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === sep && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

// ---- selectors ---------------------------------------------------------------------------------------------
// One compound ("button.zn-chip[hidden]:not(.is-on)") as a list of simple selectors.
function parseCompound(text, unsupported) {
  const parts = []; let i = 0;
  const ident = () => { const m = /^(?:\\.|[\w-]|[^\x00-\x7f])+/.exec(text.slice(i)); if (!m) return ""; i += m[0].length; return m[0].replace(/\\(.)/g, "$1"); };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "*") { i++; parts.push({ kind: "any" }); }
    else if (ch === ".") { i++; parts.push({ kind: "class", name: ident() }); }
    else if (ch === "#") { i++; parts.push({ kind: "id", name: ident() }); }
    else if (ch === "[") {
      const end = closing(text, i, "[", "]"); if (end < 0) { unsupported.push(text); return null; }
      const m = /^\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?\s*[is]?\s*$/.exec(text.slice(i + 1, end));
      if (!m) { unsupported.push(text); return null; }
      parts.push({ kind: "attr", name: m[1], op: m[2] || "", value: m[3] ?? m[4] ?? m[5] ?? "" });
      i = end + 1;
    } else if (ch === ":") {
      const element = text[i + 1] === ":"; i += element ? 2 : 1;
      const name = ident().toLowerCase(); let arg = null;
      if (text[i] === "(") { const end = closing(text, i, "(", ")"); if (end < 0) { unsupported.push(text); return null; } arg = text.slice(i + 1, end); i = end + 1; }
      if (element || ["before", "after", "first-line", "first-letter", "placeholder", "selection", "marker", "backdrop"].includes(name)) parts.push({ kind: "element", name });
      else if (name === "not" || name === "is" || name === "where") parts.push({ kind: name, list: splitTop(arg || "", ",").map((s) => parseComplex(s, unsupported)) });
      else if (name === "root" || name === "first-child" || name === "last-child" || name === "only-child") parts.push({ kind: name });
      else if (STATE_PSEUDOS.has(name)) parts.push({ kind: "state", name });
      else { unsupported.push(text); parts.push({ kind: "never", name }); }
    } else {
      const name = ident(); if (!name) { unsupported.push(text); return null; }
      parts.push({ kind: "type", name: name.toLowerCase() });
    }
  }
  return parts;
}
// "a > b c" -> [{ parts, comb: null }, { parts, comb: ">" }, { parts, comb: " " }]; null when it cannot be matched.
function parseComplex(text, unsupported) {
  const chain = []; let depth = 0, cur = "", comb = null;
  const push = () => { if (!cur) return true; const parts = parseCompound(cur, unsupported); if (!parts) return false; chain.push({ parts, comb: chain.length ? comb || " " : null }); cur = ""; comb = null; return true; };
  const s = text.trim();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") { const j = s.indexOf(ch, i + 1); if (j < 0) return null; cur += s.slice(i, j + 1); i = j; continue; }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && (ch === " " || ch === ">" || ch === "+" || ch === "~" || ch === "\n" || ch === "\t")) {
      if (!push()) return null;
      if (ch === "+" || ch === "~") { unsupported.push(text); return null; }
      if (ch === ">") comb = ">"; else if (comb !== ">") comb = " ";
      continue;
    }
    cur += ch;
  }
  if (!push() || !chain.length) return null;
  return chain;
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const greater = (a, b) => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0;
function specificity(chain) {
  let total = [0, 0, 0];
  for (const { parts } of chain || []) for (const p of parts) {
    if (p.kind === "id") total = add(total, [1, 0, 0]);
    else if (p.kind === "type" || p.kind === "element") total = add(total, [0, 0, 1]);
    else if (p.kind === "not" || p.kind === "is") total = add(total, p.list.map(specificity).reduce((m, x) => (greater(x, m) ? x : m), [0, 0, 0]));
    else if (p.kind !== "any" && p.kind !== "where") total = add(total, [0, 1, 0]);
  }
  return total;
}

// ---- matching against the fake DOM ---------------------------------------------------------------------------
const ROOT = Object.freeze({ root: true });
const parentOf = (el) => (el === ROOT ? null : el.parent || ROOT);
const camel = (name) => name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function attrOf(el, name, env) {
  if (el === ROOT) return env.rootAttrs && name in env.rootAttrs ? String(env.rootAttrs[name]) : null;
  if (name === "class") return el.className || null;
  if (name === "hidden") return el.hidden ? "" : el.getAttribute("hidden");
  const own = el.getAttribute(name);
  if (own !== null) return own;
  if (name.startsWith("data-") && el.dataset && el.dataset[camel(name)] !== undefined) return String(el.dataset[camel(name)]);
  return null;
}
function matchAttr(have, op, want) {
  if (have === null) return false;
  if (!op) return true;
  if (op === "=") return have === want;
  if (op === "~=") return have.split(/\s+/).includes(want);
  if (op === "^=") return want !== "" && have.startsWith(want);
  if (op === "$=") return want !== "" && have.endsWith(want);
  if (op === "*=") return want !== "" && have.includes(want);
  return have === want || have.startsWith(want + "-"); // |=
}
function matchCompound(el, parts, env) {
  const real = el !== ROOT;
  const siblings = () => (real && el.parent ? el.parent.children.filter((c) => c.tag !== "#text") : [el]);
  for (const p of parts) {
    let ok;
    if (p.kind === "any") ok = real;
    else if (p.kind === "type") ok = real && String(el.tag).toLowerCase() === p.name;
    else if (p.kind === "class") ok = real && el._classes.has(p.name);
    else if (p.kind === "id") ok = real && el.id === p.name;
    else if (p.kind === "attr") ok = matchAttr(attrOf(el, p.name, env), p.op, p.value);
    else if (p.kind === "root") ok = !real;
    else if (p.kind === "not") ok = !p.list.some((chain) => chain && matchChain(el, chain, env));
    else if (p.kind === "is" || p.kind === "where") ok = p.list.some((chain) => chain && matchChain(el, chain, env));
    else if (p.kind === "first-child") ok = real && siblings()[0] === el;
    else if (p.kind === "last-child") ok = real && siblings().at(-1) === el;
    else if (p.kind === "only-child") ok = real && siblings().length === 1;
    else if (p.kind === "state") ok = real && !!env.states && env.states(el, p.name) === true;
    else ok = false; // pseudo-elements and anything unknown
    if (!ok) return false;
  }
  return true;
}
function matchChain(el, chain, env, i = chain.length - 1) {
  if (!matchCompound(el, chain[i].parts, env)) return false;
  if (i === 0) return true;
  for (let p = parentOf(el); p; p = parentOf(p)) {
    if (matchChain(p, chain, env, i - 1)) return true;
    if (chain[i].comb === ">") break;
  }
  return false;
}

// ---- the style sheet -------------------------------------------------------------------------------------------
const FLEX_WORDS = { none: ["0", "0", "auto"], auto: ["1", "1", "auto"], initial: ["0", "1", "auto"] };
function expand(prop, value) {
  if (prop === "flex") {
    const w = splitTop(value, " ");
    if (w.length === 1 && FLEX_WORDS[w[0]]) return Object.entries({ "flex-grow": FLEX_WORDS[w[0]][0], "flex-shrink": FLEX_WORDS[w[0]][1], "flex-basis": FLEX_WORDS[w[0]][2] });
    const nums = w.filter((x) => /^[\d.]+$/.test(x)), rest = w.filter((x) => !/^[\d.]+$/.test(x));
    return Object.entries({ "flex-grow": nums[0] ?? "1", "flex-shrink": nums[1] ?? "1", "flex-basis": rest[0] ?? (nums.length === 3 ? nums[2] : "0%") });
  }
  if (prop === "flex-flow") { const w = value.split(/\s+/); return Object.entries({ "flex-direction": w.find((x) => /^(row|column)/.test(x)) || "row", "flex-wrap": w.find((x) => /wrap/.test(x)) || "nowrap" }); }
  if (prop === "overflow") { const w = value.split(/\s+/); return [["overflow-x", w[0]], ["overflow-y", w[1] || w[0]]]; }
  if (prop === "gap") { const w = splitTop(value, " "); return [["row-gap", w[0]], ["column-gap", w[1] || w[0]]]; }
  return [];
}
function parseDeclarations(block) {
  const out = [];
  for (const piece of splitTop(block, ";")) {
    const at = piece.indexOf(":"); if (at < 0) continue;
    const prop = piece.slice(0, at).trim().toLowerCase();
    let value = piece.slice(at + 1).trim().replace(/\s+/g, " ");
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/\s*!\s*important$/i, "");
    out.push({ prop, value, important });
    if (!prop.startsWith("--")) for (const [p, v] of expand(prop, value)) out.push({ prop: p, value: v, important });
  }
  return out;
}
function parseCss(source) {
  const text = String(source).replace(/\/\*[\s\S]*?\*\//g, " ");
  const rules = [], unsupported = [];
  let order = 0;
  (function block(from, to, conditional) {
    let i = from;
    while (i < to) {
      const brace = text.indexOf("{", i), semi = text.indexOf(";", i);
      if (brace < 0 || brace >= to) break;
      if (semi >= 0 && semi < brace && text.slice(i, semi).trim().startsWith("@")) { i = semi + 1; continue; } // @import ...;
      const end = closing(text, brace, "{", "}");
      if (end < 0) throw new Error("css-cascade: unbalanced braces after: " + text.slice(i, brace).trim().slice(0, 80));
      const prelude = text.slice(i, brace).trim();
      if (prelude.startsWith("@")) {
        if (/^@(media|supports|container|layer)\b/i.test(prelude)) block(brace + 1, end, conditional ? conditional + " and " + prelude : prelude);
        // @keyframes, @font-face, @page, @property: no rule for an element inside
      } else {
        const declarations = parseDeclarations(text.slice(brace + 1, end));
        for (const selector of splitTop(prelude, ",")) {
          const chain = parseComplex(selector, unsupported);
          rules.push({ selector: selector.replace(/\s+/g, " "), chain, specificity: specificity(chain), declarations, order: order++, conditional: conditional || null });
        }
      }
      i = end + 1;
    }
  })(0, text.length, null);
  return { rules, unsupported: [...new Set(unsupported)] };
}

// The winning value of every property the style sheet sets on `el`. `env.rootAttrs` are the attributes on the root
// element ({ "zentral-notes-wrap": "on" }), `env.states(el, name)` says whether a state such as "hover" is on, and
// `env.media(condition)` whether the rules of an @media / @supports block apply (default: they do not).
function cascade(sheet, el, env = {}) {
  const won = new Map();
  for (const rule of sheet.rules) {
    if (!rule.chain) continue;
    if (rule.conditional && !(env.media && env.media(rule.conditional))) continue;
    if (!matchChain(el, rule.chain, env)) continue;
    for (const d of rule.declarations) {
      const cur = won.get(d.prop);
      const beats = !cur || (d.important !== cur.important ? d.important : !greater(cur.rule.specificity, rule.specificity));
      if (beats) won.set(d.prop, { value: d.value, important: d.important, rule });
    }
  }
  return {
    get: (prop) => won.get(prop)?.value ?? "",
    rule: (prop) => won.get(prop)?.rule.selector ?? "",
    line: (prop) => (won.has(prop) ? `${prop}: ${won.get(prop).value}  (${won.get(prop).rule.selector})` : `${prop}: not set`),
    props: () => [...won.keys()],
  };
}
// Every rule that matches `el`, in the order the browser would apply them (the last one wins).
function matching(sheet, el, env = {}) {
  return sheet.rules
    .filter((r) => r.chain && (!r.conditional || (env.media && env.media(r.conditional))) && matchChain(el, r.chain, env))
    .sort((a, b) => (greater(a.specificity, b.specificity) ? 1 : greater(b.specificity, a.specificity) ? -1 : a.order - b.order));
}

module.exports = { parseCss, cascade, matching, specificity, parseComplex };
