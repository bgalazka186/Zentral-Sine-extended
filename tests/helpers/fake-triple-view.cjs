"use strict";
/* Triple View for the Notes tests: the REAL extension/panels/secondary-views/ZentralSecondaryViews.uc.js runs beside
 * the real Notes script in one fake window (tests/helpers/fake-panel-window.cjs), on that world's virtual clock.
 * tests/notes-slot-geometry.test.cjs models the two pages with a formula that assumes the panel suite has already
 * answered Notes; here the suite's own code has to answer, so an answer that never comes, comes late or goes to the
 * wrong element shows.
 *
 * What the two scripts read from the browser is answered here:
 *   - boxes (getBoundingClientRect, offsetHeight, clientTop, getClientRects) of the panel, its slider and the slider's
 *     children come from a one-column flex layout that applies the declarations of the real style sheets
 *     (tests/helpers/css-cascade.cjs) together with the custom properties the scripts write. A height nobody wrote
 *     therefore falls back to what the style sheet says, not to what a model assumes;
 *   - requestAnimationFrame runs once per 16 ms frame and can be cancelled; ResizeObservers are told after the
 *     frame's callbacks about the elements they observe; MutationObservers are told at the end of the task, each only
 *     about what it asked for (the stand-in in fake-panel-window.cjs tells every observer of a target everything);
 *   - a press goes to the element that is on top at that point (z-index, display and pointer-events from the same
 *     style sheets), and a captured pointer keeps going to the element that captured it;
 *   - the panel slid away by its autohide is the transform the style sheet gives it, over the 0.2 s it takes.
 * The base panel (window.Zentral.Apps) and the shared context of the panel parts are small stand-ins.
 *
 * It does NOT prove Gecko layout, remote browsers, native hit-testing, pointer capture or real timing. */
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { parseCss, cascade } = require("./css-cascade.cjs");

const REPO = path.join(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
// The sheets that lay out the panel, the Triple View stack and the Notes sheet (base first, as the loader adds them).
const STYLE_SHEETS = [
  "zentral/apps/styles/ZentralAppsInjected.css",
  "extension/panels/ZentralPanels.css",
  "extension/appearance/ZentralAppearance.css",
  "extension/panels/navigation/styles/ZentralPanelToolbar.css",
  "extension/panels/browsers/ZentralBrowserIntegrations.css",
  "additional/notes/ZentralNotes.css",
];
const SECONDARY_VIEWS = "extension/panels/secondary-views/ZentralSecondaryViews.uc.js";
let parsedSheet = null;
const styleSheet = () => (parsedSheet ||= parseCss(STYLE_SHEETS.map(read).join("\n")));

const FRAME_MS = 16;
const LEGACY_RECT = Object.freeze({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0 });
const num = (v, fallback = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
const EMPTY = Object.freeze(box(0, 0, 0, 0));
const camel = (prop) => prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// ---- observers that are really told ----------------------------------------------------------------------------
function createObservers() {
  const mutationObservers = new Set(), resizeObservers = new Set();
  let queued = false;
  class MutationObserver {
    constructor(cb) { this.cb = cb; this.targets = []; this.records = []; }
    observe(target, options = {}) {
      const known = this.targets.find((t) => t.target === target);
      if (known) known.options = options; else this.targets.push({ target, options });
      mutationObservers.add(this);
    }
    disconnect() { this.targets = []; this.records = []; mutationObservers.delete(this); }
    takeRecords() { return this.records.splice(0); }
  }
  class ResizeObserver {
    constructor(cb) { this.cb = cb; this.sizes = new Map(); }
    observe(el) { if (!this.sizes.has(el)) this.sizes.set(el, ""); resizeObservers.add(this); }
    unobserve(el) { this.sizes.delete(el); }
    disconnect() { this.sizes.clear(); resizeObservers.delete(this); }
  }
  function deliverMutations() {
    queued = false;
    for (const mo of [...mutationObservers]) { const records = mo.records.splice(0); if (records.length) mo.cb(records, mo); }
  }
  // A change of the fake DOM (called by the patched element methods).
  function record(rec) {
    if (!mutationObservers.size) return;
    let any = false;
    for (const mo of mutationObservers) {
      for (const { target, options } of mo.targets) {
        if (target !== rec.target && !(options.subtree && target.contains(rec.target))) continue;
        if (rec.type === "childList") { if (!options.childList) continue; }
        else if (!(options.attributes || options.attributeFilter) || (options.attributeFilter && !options.attributeFilter.includes(rec.attributeName))) continue;
        mo.records.push(rec); any = true;
        break;
      }
    }
    if (any && !queued) { queued = true; queueMicrotask(deliverMutations); }
  }
  // After a frame's callbacks: every observer hears about the observed elements whose box changed since it last heard.
  // Changes made by the callbacks themselves are reported in the next frame.
  function deliverResizes() {
    let told = 0;
    for (const ro of [...resizeObservers]) {
      const entries = [];
      for (const [el, before] of ro.sizes) {
        const r = el.getBoundingClientRect(), now = el.isConnected ? Math.round(r.width * 100) / 100 + "x" + Math.round(r.height * 100) / 100 : "0x0";
        if ((before || "0x0") === now) continue;
        ro.sizes.set(el, now);
        entries.push({ target: el, contentRect: r });
      }
      if (entries.length) { told++; ro.cb(entries, ro); }
    }
    return told;
  }
  return { MutationObserver, ResizeObserver, record, deliverResizes, counts: () => ({ mutation: mutationObservers.size, resize: resizeObservers.size }) };
}

// The fake elements change silently; tell the observers what a real document would tell them.
function patchDom(El, record) {
  const P = El.prototype, childList = (target, addedNodes, removedNodes) => record({ type: "childList", target, addedNodes, removedNodes });
  const append = P.append, insertBefore = P.insertBefore, remove = P.remove, replaceChildren = P.replaceChildren, replaceWith = P.replaceWith, setAttribute = P.setAttribute, removeAttribute = P.removeAttribute;
  const leaving = (target, nodes) => nodes.filter((n) => typeof n !== "string" && n.parent && n.parent !== target).map((n) => [n.parent, n]);
  P.append = function (...kids) {
    const moved = leaving(this, kids);
    append.apply(this, kids);
    for (const [from, node] of moved) childList(from, [], [node]);
    if (kids.length) childList(this, this.children.slice(-kids.length), []);
  };
  P.insertBefore = function (node, ref) {
    const moved = leaving(this, [node]);
    const out = insertBefore.call(this, node, ref);
    for (const [from, n] of moved) childList(from, [], [n]);
    childList(this, [node], []);
    return out;
  };
  P.remove = function () { const from = this.parent; remove.call(this); if (from) childList(from, [], [this]); };
  P.replaceChildren = function (...kids) { const old = this.children.slice(); replaceChildren.apply(this, kids); if (old.length) childList(this, [], old); };
  P.replaceWith = function (node) { const from = this.parent; replaceWith.call(this, node); if (from) childList(from, [node], [this]); };
  P.setAttribute = function (name, value) { setAttribute.call(this, name, value); record({ type: "attributes", target: this, attributeName: name, addedNodes: [], removedNodes: [] }); };
  P.removeAttribute = function (name) { const had = this.hasAttribute(name); removeAttribute.call(this, name); if (had) record({ type: "attributes", target: this, attributeName: name, addedNodes: [], removedNodes: [] }); };
  P.toggleAttribute = function (name, force) {
    const on = force === undefined ? !this.hasAttribute(name) : !!force;
    if (on) { if (!this.hasAttribute(name)) this.setAttribute(name, ""); } else this.removeAttribute(name);
    return on;
  };
  // The same walk as the fake DOM's own dispatchEvent, plus event.currentTarget (the scripts capture the pointer on it).
  P.dispatchEvent = function (ev) {
    ev.target = ev.target || this;
    const down = []; for (let x = this; x; x = x.parent) down.unshift(x);
    for (const node of down) {
      for (const l of [...node.listeners]) if (l.type === ev.type && l.capture) { ev.currentTarget = node; l.fn(ev); }
      if (ev.stopped) return true;
    }
    for (const node of down.reverse()) {
      for (const l of [...node.listeners]) if (l.type === ev.type && !l.capture) { ev.currentTarget = node; l.fn(ev); }
      if (ev.stopped || (node === this && !ev.bubbles && !["keydown", "click", "mousedown", "pointerdown"].includes(ev.type))) break;
    }
    ev.currentTarget = null;
    return !ev.defaultPrevented;
  };
}

/**
 * One fake window with the panel suite's Triple View in it. Options:
 *   width / height / right / top  the panel's box in the window (the panel is docked to the right edge);
 *   viewport                      { width, height } of the window;
 *   toolbarHeight                 height of the panel's URL bar while it is shown;
 *   headHeight                    height of the Notes title bar (it acts as the sheet's top edge);
 *   rootAttrs                     attributes on the root element, e.g. { "bgalazka-webtoolbar-top": "true" };
 *   hideMs                        how long the autohide slide takes (the style sheet says 0.2 s);
 *   coldMs                        a page of a newly made panel has no browsing context for this long (cold start-up).
 */
function openTripleWindow(world, { id, width = 420, height = 800, right = 12, top = 40, viewport = { width: 1280, height: 900 }, toolbarHeight = 36, headHeight = 30, rootAttrs = { "bgalazka-webtoolbar": "true" }, hideMs = 200, coldMs = 0, onRuntime = null } = {}) {
  const observers = createObservers();
  const w = world.openWindow({ id, globals: { MutationObserver: observers.MutationObserver, ResizeObserver: observers.ResizeObserver } });
  const { El, Ev, document, html, win } = w;
  patchDom(El, observers.record);
  win.innerWidth = viewport.width; win.innerHeight = viewport.height;
  document.querySelector = (sel) => html.querySelector(sel);
  document.createXULElement = (tag) => new El(tag);

  // ---- frames -----------------------------------------------------------------------------------------------------
  const frames = new Map();
  let frameSeq = 0, frameTimer = 0, stopped = false, frameCount = 0;
  const scheduleFrame = () => { if (!frameTimer && !stopped) frameTimer = win.setTimeout(runFrame, FRAME_MS - (world.now % FRAME_MS)); };
  function runFrame() {
    frameTimer = 0; frameCount++;
    for (const id2 of [...frames.keys()]) { const fn = frames.get(id2); if (!fn) continue; frames.delete(id2); fn(world.now); } // cancelled during this frame: skipped
    observers.deliverResizes();
    scheduleFrame(); // every frame while the window lives: a box can change without anybody asking for a frame
  }
  win.requestAnimationFrame = (fn) => { const id2 = ++frameSeq; frames.set(id2, fn); scheduleFrame(); return id2; };
  win.cancelAnimationFrame = (id2) => { frames.delete(id2); };

  // ---- the panel's elements (the base suite builds them at its own start) -------------------------------------------
  for (const [name, value] of Object.entries(rootAttrs)) html.setAttribute(name, value);
  const root = new El("div"); root.id = "zen-app-panel-root"; root.setAttribute("data-panel-side", "right");
  const clip = new El("div"); clip.id = "zen-app-panel-clip";
  const slider = new El("div"); slider.id = "zen-app-panel-slider";
  const toolbar = new El("div"); toolbar.id = "zen-app-panel-toolbar"; toolbar.append(new El("button"), new El("input"));
  slider.append(toolbar); clip.append(slider); root.append(clip); html.append(root);
  const panel = { left: viewport.width - right - width, top, width, height };

  // ---- style: the sheets' winning declaration, or the inline one when the sheet's is not !important ---------------
  const styleCache = new WeakMap();
  const ownKey = (x) => x.tag + "#" + [...x.attrs].join() + "." + [...x._classes].join(".") + (Object.keys(x.dataset).length ? JSON.stringify(x.dataset) : "");
  function styleOf(el) {
    let key = "";
    for (let x = el; x; x = x.parent) key += ownKey(x) + "|";
    const cached = styleCache.get(el);
    if (cached && cached.key === key) return cached.css;
    const css = cascade(styleSheet(), el, { rootAttrs: Object.fromEntries(html.attrs) });
    styleCache.set(el, { key, css });
    return css;
  }
  function inlineOf(el, prop) {
    if (prop === "display") return el.style.display || "";
    if (prop.startsWith("flex-") && el.style.flex) { const n = String(el.style.flex).trim(); return prop === "flex-basis" ? "0%" : n; } // "flex: 1"
    return el.style[camel(prop)] ?? "";
  }
  function decl(el, prop) {
    const css = styleOf(el), inline = inlineOf(el, prop);
    return inline !== "" && !css.important(prop) ? String(inline) : css.get(prop) || String(inline);
  }
  const customProperty = (el, name) => { for (let x = el; x; x = x.parent) { const v = x.style.getPropertyValue(name); if (v) return v; } return ""; };
  function resolved(value, el) {
    let v = String(value || "").trim();
    for (let i = 0; i < 4; i++) {
      const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$/.exec(v);
      if (!m) break;
      v = (customProperty(el, m[1]) || m[2] || "").trim();
    }
    return v;
  }
  // A length in px, NaN when the value says nothing ("auto", "none", unset).
  function lengthOf(value, el, percentOf) {
    const v = resolved(value, el);
    if (v.endsWith("%")) return (percentOf * parseFloat(v)) / 100;
    return /^-?[\d.]+(px)?$/.test(v) ? parseFloat(v) : NaN;
  }
  const shown = (el) => !el.hidden && !el.hasAttribute("hidden") && decl(el, "display") !== "none";
  const laidOut = (el) => el === root || el === clip || el === slider || el.parent === slider;
  function displayed(el) {
    if (!el.isConnected) return false;
    for (let x = el; x && x !== html; x = x.parent) if (laidOut(x) || x.parent === document.body || x.parent === html ? !shown(x) : x.hidden || x.style.display === "none") return false;
    return true;
  }

  // ---- the autohide slide: the transform the sheet gives the panel root, reached over hideMs ----------------------
  const slide = { from: 0, to: 0, at: 0, ms: 0 };
  const slideNow = () => (slide.ms > 0 ? slide.from + (slide.to - slide.from) * Math.max(0, Math.min(1, (world.now - slide.at) / slide.ms)) : slide.to);
  function offsetX() {
    const t = decl(root, "transform");
    const m = /translateX\(\s*calc\(\s*(-?)100%\s*([+-])\s*var\(--bgalazka-hover-outset,\s*([\d.]+)px\)/.exec(t || "");
    const to = m ? (m[1] === "-" ? -1 : 1) * (panel.width + num(root.style.getPropertyValue("--bgalazka-hover-outset"), num(m[3]))) : 0;
    if (to !== slide.to) Object.assign(slide, { from: slideNow(), to, at: world.now, ms: /transform/.test(decl(root, "transition")) ? hideMs : 0 });
    return slideNow();
  }

  // ---- layout of the slider: a one-column flex container ------------------------------------------------------------
  const borderOf = (el) => num(/^([\d.]+)px/.exec(decl(el, "border") || "")?.[1], 0);
  const intrinsic = (el) => (el === toolbar ? toolbarHeight : 0);
  // Everything the layout reads, as one string: the same string means the same boxes.
  const inlineKey = (x) => (x.hidden ? "H" : "") + [x.style.display, x.style.position, x.style.flex, x.style.left, x.style.top, x.style.width, x.style.height].join("/") + (x.style._props.size ? [...x.style._props].join() : "");
  let laid = { key: null, rects: new Map(), panelShown: false };
  function layoutNow() {
    let key = "";
    for (const x of [html, root, clip, slider, ...slider.children]) key += ownKey(x) + inlineKey(x) + "|";
    if (key !== laid.key) {
      const panelShown = root.isConnected && shown(root) && shown(clip) && shown(slider);
      laid = { key, panelShown, rects: panelShown ? stack() : new Map() };
    }
    return laid;
  }
  function stack() {
    const b = borderOf(slider), pad = lengthOf(decl(slider, "padding-bottom"), slider, 0) || 0;
    const inner = box(panel.left + b, panel.top + b, panel.width - 2 * b, panel.height - 2 * b); // padding box: absolute children are placed in it
    const room = inner.height - pad, out = new Map(), flow = [];
    slider.children.forEach((el, index) => {
      if (el.tag === "#text") return;
      if (!shown(el)) return void out.set(el, EMPTY);
      const position = decl(el, "position");
      if (position === "absolute" || position === "fixed") return void out.set(el, box(inner.left + num(el.style.left), inner.top + num(el.style.top), num(el.style.width), num(el.style.height)));
      let size = lengthOf(decl(el, "flex-basis"), el, room);
      if (!Number.isFinite(size)) size = lengthOf(decl(el, "height"), el, room);
      if (!Number.isFinite(size)) size = intrinsic(el);
      const max = lengthOf(decl(el, "max-height"), el, room), min = lengthOf(decl(el, "min-height"), el, room);
      if (Number.isFinite(max)) size = Math.min(size, max);
      if (Number.isFinite(min)) size = Math.max(size, min);
      flow.push({ el, index, size, order: num(decl(el, "order")), grow: num(decl(el, "flex-grow")), shrink: num(decl(el, "flex-shrink"), 1), marginTop: lengthOf(decl(el, "margin-top"), el, 0) || 0 });
    });
    flow.sort((a, c) => a.order - c.order || a.index - c.index);
    const free = room - flow.reduce((sum, f) => sum + f.size + f.marginTop, 0);
    const grow = flow.reduce((sum, f) => sum + f.grow, 0), weight = flow.reduce((sum, f) => sum + f.shrink * f.size, 0);
    if (free > 0 && grow > 0) for (const f of flow) f.size += (free * f.grow) / grow;
    else if (free < 0 && weight > 0) for (const f of flow) f.size = Math.max(0, f.size + (free * f.shrink * f.size) / weight);
    let y = inner.top;
    for (const f of flow) { y += f.marginTop; out.set(f.el, box(inner.left, y, inner.width, f.size)); y += f.size; }
    return out;
  }
  const moved = (r, dx) => (dx ? box(r.left + dx, r.top, r.width, r.height) : r);
  // Fixed children of <body> / <html> (the divider handle, the drag shields): the inline box, or the whole window.
  function fixedRect(el) {
    if (decl(el, "inset") === "0") return box(0, 0, viewport.width, viewport.height);
    return box(num(el.style.left), num(el.style.top), num(el.style.width), num(el.style.height));
  }
  // null = not an element this layout knows: the caller keeps the stand-in box of the other tests.
  function rectOf(el) {
    if (el === html || el === document.body) return box(0, 0, viewport.width, viewport.height);
    if (el === root || el === clip || el === slider) return layoutNow().panelShown ? moved(box(panel.left, panel.top, panel.width, panel.height), offsetX()) : EMPTY;
    if (el.parent === slider) { const now = layoutNow(); return now.panelShown ? moved(now.rects.get(el) || EMPTY, offsetX()) : EMPTY; }
    if (el.parent === document.body || el.parent === html) return decl(el, "position") === "fixed" ? (displayed(el) ? fixedRect(el) : EMPTY) : null;
    for (let x = el.parent; x && x !== html; x = x.parent) {
      if (x._classes.has("zentral-notes-sheet")) return null; // the inside of the Notes sheet is not laid out here
      if (x.parent === slider) return displayed(el) ? rectOf(x) : EMPTY; // a bar's controls: the bar's box is close enough
    }
    return null;
  }
  const P = El.prototype;
  P.getBoundingClientRect = function () { return rectOf(this) || LEGACY_RECT; };
  P.getClientRects = function () { const r = rectOf(this); return r ? (displayed(this) ? [r] : []) : [{}]; };
  for (const [name, read2] of [["offsetHeight", (r) => Math.round(r.height)], ["offsetWidth", (r) => Math.round(r.width)]])
    Object.defineProperty(P, name, { get() { return read2(rectOf(this) || LEGACY_RECT); }, configurable: true });
  for (const name of ["clientTop", "clientLeft"]) Object.defineProperty(P, name, { get() { return this === slider ? borderOf(slider) : 0; }, configurable: true });

  // ---- which element a press reaches ---------------------------------------------------------------------------------
  function pointerEvents(el) {
    for (let x = el; x && x !== html; x = x.parent) { const v = decl(x, "pointer-events"); if (v) return v; }
    return "auto";
  }
  const contains = (r, x, y) => r.width > 0 && r.height > 0 && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  const zIndex = (el) => num(decl(el, "z-index"));
  // Inside the Notes sheet only its edges and its title bar matter here: the grips the sheet shows, then the title bar.
  function sheetTarget(sheet, x, y) {
    const r = rectOf(sheet);
    for (const grip of sheet.querySelectorAll(".zn-rz")) {
      const css = styleOf(grip);
      if (css.get("display") === "none" || css.get("pointer-events") === "none") continue;
      const h = num(css.get("height"), NaN), wd = num(css.get("width"), NaN), l = num(css.get("left"), NaN), rt = num(css.get("right"), NaN), t = num(css.get("top"), NaN), bt = num(css.get("bottom"), NaN);
      const gw = Number.isFinite(wd) ? wd : r.width - (l || 0) - (rt || 0), gh = Number.isFinite(h) ? h : r.height - (t || 0) - (bt || 0);
      const gl = Number.isFinite(l) ? r.left + l : r.right - (rt || 0) - gw, gt = Number.isFinite(t) ? r.top + t : r.bottom - (bt || 0) - gh;
      if (contains(box(gl, gt, gw, gh), x, y)) return grip;
    }
    const head = sheet.querySelector(".zn-head");
    return head && y < r.top + headHeight ? head : sheet;
  }
  function panelTarget(x, y) {
    if (!contains(rectOf(slider), x, y)) return null;
    const kids = slider.children.filter((el) => el.tag !== "#text" && displayed(el));
    const absolute = kids.filter((el) => /^(absolute|fixed)$/.test(decl(el, "position"))).sort((a, c) => zIndex(c) - zIndex(a));
    for (const el of [...absolute, ...kids.filter((k) => !absolute.includes(k))]) {
      if (!contains(rectOf(el), x, y) || pointerEvents(el) === "none") continue;
      return el._classes.has("zentral-notes-sheet") ? sheetTarget(el, x, y) : el;
    }
    return pointerEvents(slider) === "none" ? null : slider;
  }
  // The element on top at (x, y); null = the page behind the panel.
  function hit(x, y) {
    const layers = [...document.body.children, ...html.children].filter((el) => el.tag !== "#text" && el !== document.body && decl(el, "position") === "fixed" && displayed(el)).sort((a, c) => zIndex(c) - zIndex(a));
    for (const el of layers) {
      if (el === root) { const inside = panelTarget(x, y); if (inside) return inside; continue; }
      if (pointerEvents(el) !== "none" && contains(rectOf(el), x, y)) return el;
    }
    return null;
  }
  const captured = new Map();
  P.setPointerCapture = function (pointerId) { captured.set(pointerId, this); };
  P.releasePointerCapture = function (pointerId) { if (captured.get(pointerId) === this) captured.delete(pointerId); };
  P.hasPointerCapture = function (pointerId) { return captured.get(pointerId) === this; };
  // Window (capture), document, the element and its ancestors, window (bubble): the order a real event takes.
  function fire(target, type, init = {}) {
    const ev = new Ev(type, { bubbles: true, button: 0, ...init });
    ev.target = target || document.body;
    for (const l of w.listeners.filter((x) => x.type === type && x.capture)) { l.fn(ev); if (ev.stopped) return ev; }
    for (const l of [...document._listeners]) if (l.type === type) { l.fn(ev); if (ev.stopped) return ev; }
    ev.target.dispatchEvent(ev);
    if (!ev.stopped) for (const l of w.listeners.filter((x) => x.type === type && !x.capture)) l.fn(ev);
    return ev;
  }
  const pointer = {
    // Press at a point: the element under it gets pointerdown, then (unless that was cancelled) mousedown.
    down(x, y, pointerId = 1) {
      const target = hit(x, y), at = { clientX: x, clientY: y, pointerId };
      const ev = fire(target, "pointerdown", at);
      if (!ev.defaultPrevented) fire(target, "mousedown", at);
      return target;
    },
    move(x, y, pointerId = 1) { const at = { clientX: x, clientY: y, pointerId }; fire(captured.get(pointerId) || hit(x, y), "pointermove", at); },
    up(x, y, pointerId = 1) {
      const target = captured.get(pointerId) || hit(x, y), at = { clientX: x, clientY: y, pointerId };
      fire(target, "pointerup", at); fire(target, "mouseup", at);
      captured.delete(pointerId);
    },
  };

  // ---- the base panel (window.Zentral.Apps): opens the panel on one app and shows that app's page -------------------
  const browsers = new Map();
  const apps = {
    openPanel(app) {
      const { browser } = this.getOrCreateAppBrowser(app);
      for (const [appId, b] of browsers) b.style.display = appId === app.id ? "" : "none";
      html.setAttribute("zentral-app-panel-open", "true");
      root.removeAttribute("closing"); root.setAttribute("open", "true");
      return browser;
    },
    closePanel() { root.removeAttribute("open"); html.removeAttribute("zentral-app-panel-open"); },
    closeApp(appId) { browsers.get(appId)?.remove(); browsers.delete(appId); },
    removeApp(appId) { this.closeApp(appId); },
    renderGrid() {}, loadApps() {}, togglePin() {}, selectHostedPanelBrowser() {}, restorePanelViewState() {},
    capturePanelViewState: () => ({ open: root.hasAttribute("open") }),
    getOrCreateAppBrowser(app) {
      let browser = browsers.get(app.id), isNew = false;
      if (!browser?.isConnected) {
        browser = new El("browser"); isNew = true;
        browser._bgalazkaAppId = app.id;
        browser.style.flex = "1"; // the base gives every page "width: 100%; height: 100%; flex: 1" inline
        browser.currentURI = { spec: "about:blank" };
        browser.loadURI = (uri) => { browser.currentURI = { spec: uri?.spec || String(uri) }; };
        browser.reload = () => {};
        const ready = () => { browser.browsingContext = { currentWindowGlobal: {} }; };
        if (coldMs > 0) win.setTimeout(ready, coldMs); else ready();
        slider.append(browser);
        browsers.set(app.id, browser);
      }
      return { browser, isNew };
    },
  };
  win.Zentral = { Apps: apps };

  // ---- the context the panel parts share (only what the secondary views use) ----------------------------------------
  const cleanups = [], retries = new Map(), saved = { pairs: 0 };
  const ctx = {
    registerCleanup: (fn) => void cleanups.push(fn),
    getPref: (key, fallback) => (world.prefs.has(key) ? world.prefs.get(key) : fallback),
    setPref: (key, value) => world.prefs.set(key, value),
    setTimeout: (fn, ms) => win.setTimeout(fn, ms), clearTimeout: (timer) => win.clearTimeout(timer),
    essentialPanels: new Map(), linkedTriplePairs: [],
    linkedPairFor: (appId) => ctx.linkedTriplePairs.find((p) => p.top === appId || p.bottom === appId) || null,
    saveLinkedTriplePairs() { saved.pairs++; },
    unlinkTriplePair(appId) { ctx.linkedTriplePairs = ctx.linkedTriplePairs.filter((p) => p.top !== appId && p.bottom !== appId); },
    getAllAppBrowsers: () => [...browsers.values()],
    // Like the suite's own: run now, and while the task says "not yet" (false) try again every 500 ms, twice.
    retryPanelTask(key, task) {
      ctx.cancelPanelRetry(key);
      if (task() !== false) return;
      let left = 2;
      const again = () => { retries.delete(key); if (task() === false && --left > 0) retries.set(key, win.setTimeout(again, 500)); };
      retries.set(key, win.setTimeout(again, 500));
    },
    cancelPanelRetry(key) { if (retries.has(key)) win.clearTimeout(retries.get(key)); retries.delete(key); },
    syncPanelPushState() {}, syncAppPanelBrowserActivity() {}, requestPanelActivity() {}, syncPanelFallbackPolling() {}, updateWebToolbarState() {},
    zenCssEnabled: () => false, attachZenInternetPanelBrowser() {}, updateZenCssBrowser() {},
    parseSVG: () => new El("svg"), PREF_ICONS: new Proxy({}, { get: (_, name) => String(name) }),
    navigatePanelHistory() {}, getPanelQuickSwitchTarget: () => null, persistPanelZoom() {},
    looksLikeUrl: () => true, buildSearchUrl: (v) => v, BGALAZKA_EXT_PREFS: { WEB_TOOLBAR_QUICKSWITCH: "zen.workspace.bgalazka.web_toolbar_quickswitch" },
    floating: null,
  };
  let part = null;
  Object.assign(win.ZentralRuntime, { registerPart: (_name, generator) => { part = generator; }, sidebarSafeBounds: () => ({ left: 0, right: viewport.width }) });
  if (typeof onRuntime === "function") onRuntime(win.ZentralRuntime, ctx);
  const Services = {
    prefs: {
      setStringPref: (key, value) => world.prefs.set(key, value),
      setBoolPref: (key, value) => world.prefs.set(key, !!value),
    },
    obs: { addObserver() {}, removeObserver() {} },
    io: { newURI: (spec) => ({ spec }) },
    scriptSecurityManager: { createContentPrincipal: () => ({}) },
  };
  vm.runInNewContext(read(SECONDARY_VIEWS), {
    window: win, document, Services, globalThis: { Services }, console, Event: Ev, Math, JSON, Number, Object, Array, Map, Set, Date, Promise,
    ChromeUtils: { generateQI: () => () => null }, Ci: { nsIWebProgress: { NOTIFY_LOCATION: 1, NOTIFY_STATE_NETWORK: 2 } },
    ZoomManager: { getZoomForBrowser: () => 1, setZoomForBrowser() {} },
    MutationObserver: observers.MutationObserver, ResizeObserver: observers.ResizeObserver,
    requestAnimationFrame: (fn) => win.requestAnimationFrame(fn), cancelAnimationFrame: (frame) => win.cancelAnimationFrame(frame),
  }, { filename: SECONDARY_VIEWS });
  const run = part(ctx);
  run.next(); run.next(); // prepare, then activate

  const one = (el, sel) => (el ? el.querySelectorAll(sel)[0] || null : null);
  const api = {
    w, win: w, document, html, root, slider, toolbar, apps, ctx, panel, viewport, observers, pointer, hit, saved,
    rect: (el) => rectOf(el) || LEGACY_RECT,
    style: (el, prop) => decl(el, prop),
    get frames() { return frameCount; },
    // A linked pair as the suite stores it; `share` = the upper page's part of the two pages.
    link(topId, bottomId, share = 0.5) {
      const pair = { top: topId, bottom: bottomId, share, apps: { [topId]: { id: topId, url: "https://" + topId + ".test/" }, [bottomId]: { id: bottomId, url: "https://" + bottomId + ".test/" } } };
      ctx.linkedTriplePairs.push(pair);
      world.prefs.set("zen.workspace.apps.sidebar.apps", JSON.stringify(Object.values(pair.apps)));
      return pair;
    },
    // What a launcher tile or "Open at Startup" does: the suite's own openPanel (a linked app brings its pair).
    openApp(appId) { const app = JSON.parse(world.prefs.get("zen.workspace.apps.sidebar.apps") || "[]").find((a) => a.id === appId) || { id: appId, url: "https://" + appId + ".test/" }; return apps.openPanel(app); },
    // The panel's own autohide: the attributes ZentralPanelHover.js sets.
    autohide(on = true) { html.toggleAttribute("bgalazka-hover-panel-enabled", on); if (!on) html.removeAttribute("bgalazka-hover-panel-hidden"); },
    hide() { html.toggleAttribute("bgalazka-hover-panel-enabled", true); html.toggleAttribute("bgalazka-hover-panel-hidden", true); },
    reveal() { html.toggleAttribute("bgalazka-hover-panel-hidden", false); },
    get hidden() { return html.hasAttribute("bgalazka-hover-panel-hidden"); },
    // The panel gets another height (the window was resized, a toolbar of the browser came or went). Nobody is told:
    // the ResizeObservers notice it after the next frame, as in the browser.
    resizePanel(height) { panel.height = height; laid.key = null; },
    get slideOffset() { return offsetX(); },
    // The elements of the stack as they are now.
    parts() {
      const pages = slider.children.filter((el) => el.tag === "browser" && displayed(el));
      const second = one(slider, "#bgalazka-super-panel");
      return {
        upper: pages.find((b) => b.getAttribute("data-bgalazka-triple-slot") === "top") || null,
        lower: pages.find((b) => b.getAttribute("data-bgalazka-triple-slot") === "bottom") || null,
        pages, toolbar, divider: one(slider, ".bgalazka-triple-divider"), second, bar: one(second, ".bgalazka-super-bar"),
        handle: document.body.children.find((el) => el._classes.has("bgalazka-triple-drag-handle")) || null,
        sheet: slider.children.find((el) => el._classes.has("zentral-notes-sheet") && !el.hidden) || null,
        strip: slider.children.find((el) => el._classes.has("zentral-notes-reveal")) || null,
        swap: one(second, ".bgalazka-second-swap"),
      };
    },
    // Boxes of the stack, rounded, for assertions and failure messages.
    boxes() {
      const p = api.parts(), out = {};
      for (const [name, el] of Object.entries({ slider, upper: p.upper, toolbar, divider: p.divider, second: p.second, lower: p.lower, handle: p.handle, sheet: p.sheet, strip: p.strip })) {
        if (!el) continue;
        const r = api.rect(el);
        out[name] = { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, left: Math.round(r.left * 10) / 10, height: Math.round(r.height * 10) / 10 };
      }
      return out;
    },
    stop() { stopped = true; if (frameTimer) win.clearTimeout(frameTimer); frameTimer = 0; for (const fn of cleanups.splice(0).reverse()) { try { fn(); } catch (_) {} } },
  };
  scheduleFrame();
  return api;
}

module.exports = { openTripleWindow, STYLE_SHEETS, FRAME_MS };
