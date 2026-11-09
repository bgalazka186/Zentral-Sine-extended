"use strict";
/* Minimal fake DOM shared by the Notes tests. Only what the Notes code uses. */

// ---- tiny selector engine (see El.querySelectorAll) ----
const ATTR_RE = /\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
function parseCompound(c) {
  const m = { tag: null, id: null, classes: [], attrs: [], not: [] };
  let rest = c.replace(/:not\(\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]\)/g, (_, n, a, b, d) => { m.not.push([n, a ?? b ?? d]); return ""; });
  rest = rest.replace(ATTR_RE, (_, n, a, b, d) => { m.attrs.push([n, a ?? b ?? d]); return ""; });
  const re = /([.#]?)([\w-]+)/g; let x;
  while ((x = re.exec(rest))) { if (x[1] === ".") m.classes.push(x[2]); else if (x[1] === "#") m.id = x[2]; else m.tag = x[2]; }
  return m;
}
const hasAttr = (el, [n, v]) => el.hasAttribute(n) && (v === undefined || el.getAttribute(n) === v);
const matchCompound = (el, m) => (m.tag === null || el.tag === m.tag) && (m.id === null || el.id === m.id) && m.classes.every((c) => el._classes.has(c)) && m.attrs.every((a) => hasAttr(el, a)) && !m.not.some((a) => hasAttr(el, a));
// "a > b c" -> [{m: a}, {m: b, comb: ">"}, {m: c, comb: " "}]
function parseSelector(sel) {
  return String(sel).split(",").map((part) => {
    const toks = part.trim().replace(/\s*>\s*/g, " > ").split(/\s+(?![^\[]*\])/).filter(Boolean);
    const chain = []; let comb = " ";
    for (const tk of toks) { if (tk === ">") { comb = ">"; continue; } chain.push({ m: parseCompound(tk), comb: chain.length ? comb : null }); comb = " "; }
    return chain;
  });
}
// the last compound must match `el`; the earlier ones must match ancestors (never above `scope`)
function matchChain(el, chain, scope, i = chain.length - 1) {
  if (!chain.length || !matchCompound(el, chain[i].m)) return false;
  if (i === 0) return true;
  const { comb } = chain[i];
  for (let p = el.parent; p && p !== (scope ? scope.parent : null); p = p.parent) {
    if (matchChain(p, chain, scope, i - 1)) return true;
    if (comb === ">") break;
    if (p === scope) break;
  }
  return false;
}

// ---- A generic copy of the Zen sidebar structure (shape taken from a real Zen DOM dump; every label and id here is made up) ----
// workspace > arrowscrollbox > vbox.zen-workspace-pinned-tabs-section > zen-folder > (hbox.tab-group-label-container, div.tab-group-container)
const ZEN_DEFAULT_TINT = { "--tab-group-color": "var(--tab-group-zen-workspace-color)", "--tab-group-color-invert": "var(--tab-group-zen-workspace-color-invert)", "--tab-group-color-pale": "var(--tab-group-zen-workspace-color-pale)", "--tab-group-background-color": "var(--tab-group-zen-workspace-color)", "--tab-group-text-color": "var(--tab-group-zen-workspace-color-text)", "--tab-group-text-color-invert": "var(--tab-group-zen-workspace-color-text-invert)", "--tab-group-background-color-hover": "var(--tab-group-zen-workspace-color-hover)" };
const ZEN_FOLDER_DEFAULT_VARS = { "--zen-folder-behind-bgcolor": "light-dark(color-mix(in srgb, var(--zen-primary-color) 60%, gray), color-mix(in srgb, var(--zen-primary-color) 60%, #c1c1c1))", "--zen-folder-front-bgcolor": "light-dark(color-mix(in srgb, var(--zen-primary-color), white 70%), color-mix(in srgb, var(--zen-primary-color), black 40%))", "--zen-folder-stroke": "light-dark(color-mix(in srgb, var(--zen-primary-color) 50%, black), color-mix(in srgb, var(--zen-colors-primary) 15%, #ebebeb))" };
function makeZenSidebar({ El, document }) {
  const mk = (tag, cls = "", attrs = {}) => { const e = new El(tag); if (cls) e.className = cls; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const ws = mk("zen-workspace", "", { id: "{00000000-0000-4000-8000-000000000001}" });
  const scroll = mk("arrowscrollbox", "workspace-arrowscrollbox");
  const pinned = mk("vbox", "zen-workspace-tabs-section zen-workspace-pinned-tabs-section");
  ws.append(scroll); scroll.append(pinned); document.body.append(ws);
  // a tab: tab > stack.tab-stack > hbox.tab-content > stack.tab-icon-stack > img.tab-icon-image
  const tab = (label, attrs = {}) => {
    const t = mk("tab", "tabbrowser-tab", { label, pinned: "true", ...attrs });
    const img = mk("img", "tab-icon-image", { src: "data:image/x-icon;base64,AAAA" });
    t.append(mk("stack", "tab-stack")); t.querySelector(".tab-stack").append(mk("hbox", "tab-content")); t.querySelector(".tab-content").append(mk("stack", "tab-icon-stack")); t.querySelector(".tab-icon-stack").append(img);
    return t;
  };
  // A folder with Zen's real inner structure, copied from a runtime dump of a Zen window (labels and ids are made up).
  // Real Zen draws the icon with inline `fill: var(--zen-folder-...)` styles on the svg shapes, and zen-folders.css defines those
  // three variables on `:root, zen-folder`, i.e. on every folder element itself (so only a value on the folder, or a rule that
  // targets zen-folder, reaches the icon; a value on :root alone does not). `iconHref` is the chrome:// icon Zen draws.
  // Tag names are kept short ("div" is "html:div" in the real DOM) so the fake selector matcher can stay simple.
  const folder = (label, { id, parent = pinned, attrs = {}, iconHref = "chrome://browser/skin/zen-icons/selectable/squares.svg" } = {}) => {
    const f = mk("zen-folder", "", { id: id || "f-" + label.toLowerCase().replace(/\W+/g, "-"), label, "zen-workspace-id": ws.id, ...attrs });
    for (const [k, v] of Object.entries(ZEN_DEFAULT_TINT)) f.style.setProperty(k, v);
    // what zen-folders.css gives every folder (before any override)
    f.zenCssVars = { ...ZEN_FOLDER_DEFAULT_VARS }; // from the stylesheet, not inline; cssVar() is the "computed" value: inline wins over the rule
    f.cssVar = (k) => f.style.getPropertyValue(k) || f.zenCssVars[k] || "";
    const head = mk("hbox", "tab-group-label-container zen-squircle-before zen-drop-target", { pack: "center", context: "zenFolderActions" });
    const iconBox = mk("div", "tab-group-folder-icon");
    const svg = mk("svg", "", { width: "28", height: "28", viewBox: "0 0 27 27", fill: "none" });
    const defs = mk("defs");
    for (const gid of ["gradient-0", "gradient-1"]) { const lg = mk("linearGradient", "", { id: gid, gradientUnits: "userSpaceOnUse" }); lg.append(mk("stop", "", { offset: "0", style: "stop-color: rgb(255, 255, 255)" })); lg.append(mk("stop", "", { offset: "1", style: "stop-color: rgb(0% 0% 0%)" })); defs.append(lg); }
    svg.append(defs);
    svg.append(mk("path", "back", { style: "fill: var(--zen-folder-behind-bgcolor);" }));
    svg.append(mk("path", "back", { style: "stroke-width: 1.5px; stroke: var(--zen-folder-stroke);" }));
    svg.append(mk("rect", "front", { style: "fill: var(--zen-folder-front-bgcolor);" }));
    svg.append(mk("rect", "front", { style: "stroke-width: 1.5px; stroke: var(--zen-folder-stroke);" }));
    const g = mk("g", "icon"); g.append(mk("image", "", { href: iconHref, height: "11", width: "11" })); svg.append(g);
    const dots = mk("g", "dots", { style: "fill: var(--zen-folder-stroke);" }); for (const cx of ["10", "14", "18"]) dots.append(mk("ellipse", "", { cx, cy: "16", rx: "1.25", ry: "1.25" })); svg.append(dots);
    iconBox.append(svg); head.append(iconBox);
    const lab = mk("label", "tab-group-label", { role: "button", "aria-level": "1", "aria-expanded": "true" }); lab.textContent = label; head.append(lab);
    head.append(mk("image", "tab-reset-button reset-icon", { role: "button" }));
    const body = mk("div", "tab-group-container");
    f.append(head); f.append(body);
    f.delete = () => f.remove();
    f.addTab = (t) => { body.append(t); return t; };
    f.addFolder = (c) => { body.append(c); return c; };
    parent.append(f);
    return f;
  };
  return { ws, pinned, tab, folder, mk };
}

module.exports = function makeFakeDom() {
const state = { activeElement: null };
const raf = [];
class Ev {
  constructor(type, init = {}) {
    Object.assign(this, { bubbles: false, defaultPrevented: false, stopped: false, isComposing: false }, init, { type });
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}
class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.parent = null; this.attrs = new Map();
    this.dataset = {}; this.listeners = []; this.hidden = false; this.value = ""; this.readOnly = false;
    const props = new Map();
    // like a real CSSStyleDeclaration: `style.display = "none"` and setProperty/removeProperty("display") are the same storage
    this.style = { setProperty: (k, v) => props.set(k, String(v)), getPropertyValue: (k) => props.get(k) ?? "", removeProperty: (k) => { const o = props.get(k) ?? ""; props.delete(k); return o; }, _props: props,
      get display() { return props.get("display") ?? ""; }, set display(v) { if (v === "" || v == null) props.delete("display"); else props.set("display", String(v)); } }; this._classes = new Set(); this._text = "";
    this.selectionStart = 0; this.selectionEnd = 0; this.scrollTop = 0;
    const self = this;
    this.classList = {
      add: (...n) => n.forEach((x) => self._classes.add(x)), remove: (...n) => n.forEach((x) => self._classes.delete(x)),
      contains: (n) => self._classes.has(n),
      toggle: (n, f) => { const on = f === undefined ? !self._classes.has(n) : !!f; on ? self._classes.add(n) : self._classes.delete(n); return on; },
    };
  }
  get title() { return this.attrs.get("title") ?? ""; }
  set title(v) { this.attrs.set("title", String(v)); }
  get className() { return [...this._classes].join(" "); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === "class") this.className = v; }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  _adopt(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = this; return n; }
  append(...kids) { for (const k of kids) this.children.push(this._adopt(typeof k === "string" ? Object.assign(new El("#text"), { _text: k }) : k)); }
  appendChild(k) { this.append(k); return k; }
  replaceChildren(...kids) { this.children.forEach((c) => (c.parent = null)); this.children = []; this.append(...kids); }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(v) { this.children.forEach((c) => (c.parent = null)); this.children = []; this._text = String(v); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  // Selectors: tag, #id, .class, [attr], [attr="v"], :not([attr]), compounds of those, "a b" (descendant), "a > b", "a, b".
  // Enough for the Zen sidebar selectors the Notes code uses ('zen-folder[bgalazka-notes-folder="true"]', ".tab-group-folder-icon g.icon").
  get localName() { return this.tag; }
  get nodeType() { return this.tag === "#text" ? 3 : 1; }
  matches(sel) { return parseSelector(sel).some((chain) => matchChain(this, chain, null)); }
  querySelectorAll(sel) {
    if (sel.startsWith(":scope > ")) { const rest = sel.slice(9); return this.children.filter((e) => (rest.startsWith(".") ? e._classes.has(rest.slice(1)) : e.tag === rest)); }
    const chains = parseSelector(sel);
    return this.all().filter((e) => chains.some((c) => matchChain(e, c, this)));
  }
  addEventListener(type, fn, opts) { this.listeners.push({ type, fn, capture: opts === true || opts?.capture === true }); }
  removeEventListener(type, fn) { this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn)); }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    const path = []; for (let x = this; x; x = x.parent) path.unshift(x);
    for (const n of path) { for (const l of [...n.listeners]) if (l.type === ev.type && l.capture) l.fn(ev); if (ev.stopped) return true; }
    for (const n of [...path].reverse()) {
      for (const l of [...n.listeners]) if (l.type === ev.type && !l.capture) l.fn(ev);
      if (ev.stopped || (n === this && !ev.bubbles && !["keydown", "click", "mousedown", "pointerdown"].includes(ev.type))) break;
    }
    return !ev.defaultPrevented;
  }
  click() { this.dispatchEvent(new Ev("click", { bubbles: true })); }
  focus() { if (!this.hidden) { state.activeElement = this; this.dispatchEvent(new Ev("focus")); } }
  setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
  setRangeText(t, s, e) { this.value = this.value.slice(0, s) + t + this.value.slice(e); }
  select() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600 }; }
  getClientRects() { return [{}]; }
  get offsetParent() { return null; }
  get isConnected() { let x = this; while (x.parent) x = x.parent; return x === document.documentElement; }
  get id() { return this.attrs.get("id") ?? ""; }
  set id(v) { this.attrs.set("id", String(v)); }
  get firstChild() { return this.children[0] || null; }
  get childNodes() { return this.children; }
  replaceWith(n) { const p = this.parent; if (!p) return; const i = p.children.indexOf(this); this.parent = null; p.children.splice(i, 1); p._adopt(n); p.children.splice(i, 0, n); }
  get firstElementChild() { return this.children.find((c) => c.tag !== "#text") || null; }
  insertBefore(n, ref) { this._adopt(n); const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  get parentElement() { return this.parent; } // like the real DOM: the Notes code walks up with it
  closest(sel) { const chains = parseSelector(sel); for (let x = this; x; x = x.parent) if (chains.some((c) => matchChain(x, c, null))) return x; return null; }
}
const document = {
  createElement: (t) => new El(t), createElementNS: (_n, t) => new El(t), createTextNode: (t) => Object.assign(new El("#text"), { _text: t }),
  get activeElement() { return state.activeElement; }, execCommand: () => false,
  documentElement: new El("html"),
  getElementById: (id) => document.documentElement.all().find((e) => e.id === id) || null,
  querySelectorAll: (sel) => document.documentElement.querySelectorAll(sel),
  body: null,
};
document.body = new El("body");
document.documentElement.append(document.body);

return { El, Ev, document, raf, state, zenSidebar: () => makeZenSidebar({ El, document }) };
};
