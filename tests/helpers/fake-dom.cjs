"use strict";
/* Minimal fake DOM shared by the Notes tests. Only what the Notes code uses. */
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
    this.style = { setProperty() {}, removeProperty() {} }; this._classes = new Set(); this._text = "";
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
  querySelectorAll(sel) {
    if (sel.startsWith(":scope > ")) return this.children.filter((e) => e.tag === sel.slice(9));
    return this.all().filter((e) => (sel.startsWith(".") ? e._classes.has(sel.slice(1)) : e.tag === sel));
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
  closest(sel) { for (let x = this; x; x = x.parent) if (sel.startsWith("#") ? x.id === sel.slice(1) : sel.startsWith(".") ? x._classes.has(sel.slice(1)) : x.tag === sel) return x; return null; }
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

return { El, Ev, document, raf, state };
};
