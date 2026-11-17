"use strict";
/**
 * Reusable real-Zen 1.24.1b+ / Firefox 159+ sidebar DOM fixture harness.
 *
 * Captures the actual chrome DOM structure verified in live Zen Browser so
 * unit/guardrail tests never get fooled by idealized fake DOMs:
 *   - Firefox's unused `box#vertical-tabs` AND `vbox#sidebar-box` exist in
 *     `#browser` / `#sidebar-main` as `display: none; 0x0` hidden stubs.
 *   - Real Zen sidebar tabs live inside:
 *     `toolbox#navigator-toolbox`
 *       -> `toolbar#TabsToolbar`
 *         -> `hbox#TabsToolbar-customization-target` (mount host, e.g. 166x1310)
 *           -> `tabs#tabbrowser-tabs` (flex: 1000 1000 0%, e.g. 166x1283)
 *             -> `vbox#zen-tabs-wrapper`
 *               -> `arrowscrollbox#tabbrowser-arrowscrollbox`
 *                 -> `zen-workspace[active="true"]` (active workspace + `.zen-workspace-empty-space`)
 *                 -> `zen-workspace` (inactive off-screen workspace at `left = width`)
 *           -> `toolbar#zen-media-controls-toolbar` (hidden `display: none` when idle)
 *           -> `div#zentral-video-preview` (optional sibling right after media controls)
 *           -> `toolbarspring` (flexible spacer)
 *
 * Also supports toggling into the alternate Firefox/alt-Zen layout where
 * `#vertical-tabs` IS visible, plus simulating flex shrink when a tray opens,
 * workspace switches, tab overflow, video preview height/enlarge, and sidebar collapse.
 */

function createRealZenSidebarHarness(options = {}) {
  const initialPrefs = options.prefs || {};
  const sidebarWidth = Number.isFinite(options.sidebarWidth)
    ? options.sidebarWidth
    : 166;
  const sidebarHeight = Number.isFinite(options.sidebarHeight)
    ? options.sidebarHeight
    : 1310;
  const windowWidth = Number.isFinite(options.windowWidth)
    ? options.windowWidth
    : 2560;
  const windowHeight = Number.isFinite(options.windowHeight)
    ? options.windowHeight
    : 1380;
  const activeOccupiedHeight = Number.isFinite(options.activeOccupiedHeight)
    ? options.activeOccupiedHeight
    : 279;
  const inactiveOccupiedHeight = Number.isFinite(options.inactiveOccupiedHeight)
    ? options.inactiveOccupiedHeight
    : 1260;

  const prefs = new Map(Object.entries(initialPrefs));
  const prefObservers = [];
  let nowMs = Number.isFinite(options.nowMs)
    ? options.nowMs
    : 1_763_294_400_000; // 2025-11-16T12:00:00Z
  let nextTimerId = 1;
  const timers = new Map();
  const rafs = new Map();
  let nextRafId = 1;
  const winListeners = [];
  const docListeners = [];
  const tabListeners = [];
  const mutationObservers = [];
  const resizeObservers = [];

  class FakeClassList {
    constructor(el) {
      this._el = el;
    }
    _tokens() {
      return String(this._el.className || "")
        .split(/\s+/)
        .filter(Boolean);
    }
    contains(tok) {
      return this._tokens().includes(tok);
    }
    add(...toks) {
      const set = new Set(this._tokens());
      for (const t of toks) if (t) set.add(t);
      this._el.className = Array.from(set).join(" ");
    }
    remove(...toks) {
      const drop = new Set(toks);
      this._el.className = this._tokens()
        .filter((t) => !drop.has(t))
        .join(" ");
    }
    toggle(tok, force) {
      const has = this.contains(tok);
      const next = force === undefined ? !has : Boolean(force);
      if (next) this.add(tok);
      else this.remove(tok);
      return next;
    }
  }

  class FakeElement {
    constructor(tag, id = "") {
      this.tagName = String(tag || "div").toUpperCase();
      this.localName = String(tag || "div").toLowerCase();
      this.nodeType = 1;
      this.id = id;
      this.className = "";
      this.classList = new FakeClassList(this);
      this.textContent = "";
      this.hidden = false;
      this.parentNode = null;
      this.children = [];
      this.attrs = new Map();
      this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      this._computed = {};
      this._hovered = false;
      this.scrollTop = 0;
      this.scrollHeight = 0;
      this.clientHeight = 0;
      this._listeners = [];
      const self = this;
      this.style = {
        _props: new Map(),
        setProperty(k, v) {
          this._props.set(k, String(v));
        },
        removeProperty(k) {
          this._props.delete(k);
        },
        getPropertyValue(k) {
          return this._props.get(k) || "";
        },
        get left() {
          return this._props.get("left") || "";
        },
        set left(v) {
          this._props.set("left", String(v));
        },
        get right() {
          return this._props.get("right") || "";
        },
        set right(v) {
          this._props.set("right", String(v));
        },
        get top() {
          return this._props.get("top") || "";
        },
        set top(v) {
          this._props.set("top", String(v));
        },
        get bottom() {
          return this._props.get("bottom") || "";
        },
        set bottom(v) {
          this._props.set("bottom", String(v));
        },
        get width() {
          return this._props.get("width") || "";
        },
        set width(v) {
          this._props.set("width", String(v));
        },
        get display() {
          return this._props.get("display") || "";
        },
        set display(v) {
          this._props.set("display", String(v));
          if (v === "none") self._computed.display = "none";
          else if (self._computed.display === "none") delete self._computed.display;
        },
      };
    }
    get parentElement() {
      return this.parentNode;
    }
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === docRoot) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    get previousSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i > 0 ? this.parentNode.children[i - 1] : null;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i >= 0 && i + 1 < this.parentNode.children.length
        ? this.parentNode.children[i + 1]
        : null;
    }
    setRect(r) {
      const top = r.top ?? 0;
      const left = r.left ?? 0;
      const width = r.width ?? (r.right != null ? r.right - left : 0);
      const height = r.height ?? (r.bottom != null ? r.bottom - top : 0);
      this._rect = {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
      };
      this.clientHeight = height;
      return this;
    }
    getBoundingClientRect() {
      return { ...this._rect };
    }
    setAttribute(k, v) {
      const old = this.attrs.has(k) ? this.attrs.get(k) : null;
      this.attrs.set(k, String(v));
      if (k === "id") this.id = String(v);
      if (k === "class") this.className = String(v);
      if (k === "hidden") this.hidden = true;
      notifyMutation(this, { type: "attributes", attributeName: k, oldValue: old });
    }
    getAttribute(k) {
      if (k === "id") return this.id || null;
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    }
    hasAttribute(k) {
      return k === "hidden"
        ? this.hidden || this.attrs.has("hidden")
        : this.attrs.has(k);
    }
    removeAttribute(k) {
      const old = this.attrs.has(k) ? this.attrs.get(k) : null;
      this.attrs.delete(k);
      if (k === "hidden") this.hidden = false;
      notifyMutation(this, { type: "attributes", attributeName: k, oldValue: old });
    }
    appendChild(child) {
      if (child.parentNode) child.remove();
      child.parentNode = this;
      this.children.push(child);
      notifyMutation(this, { type: "childList", addedNodes: [child], removedNodes: [] });
      return child;
    }
    insertBefore(child, ref) {
      if (!ref) return this.appendChild(child);
      if (child.parentNode) child.remove();
      const idx = this.children.indexOf(ref);
      if (idx < 0) return this.appendChild(child);
      child.parentNode = this;
      this.children.splice(idx, 0, child);
      notifyMutation(this, { type: "childList", addedNodes: [child], removedNodes: [] });
      return child;
    }
    remove() {
      if (!this.parentNode) return;
      const p = this.parentNode;
      const idx = p.children.indexOf(this);
      if (idx >= 0) p.children.splice(idx, 1);
      this.parentNode = null;
      notifyMutation(p, { type: "childList", addedNodes: [], removedNodes: [this] });
    }
    replaceChildren(...nodes) {
      for (const ch of [...this.children]) ch.remove();
      for (const n of nodes) this.appendChild(n);
    }
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    closest(sel) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (cur.matches(sel)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
    addEventListener(type, fn) {
      this._listeners.push([type, fn]);
    }
    removeEventListener(type, fn) {
      const i = this._listeners.findIndex((x) => x[0] === type && x[1] === fn);
      if (i >= 0) this._listeners.splice(i, 1);
    }
    dispatchEvent(ev) {
      const event = {
        type: ev?.type || "",
        target: ev?.target || this,
        currentTarget: this,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {},
        ...ev,
      };
      for (const [type, fn] of [...this._listeners]) {
        if (type === event.type) fn(event);
      }
      return !event.defaultPrevented;
    }
    matches(sel) {
      return String(sel || "")
        .split(",")
        .some((part) => {
          const s = part.trim();
          if (!s) return false;
          if (s === ":hover") return Boolean(this._hovered);
          if (s.includes(">")) {
            const [parentSel, childSel] = s.split(">").map((x) => x.trim());
            if (!this.parentNode || !this.parentNode.matches(parentSel)) return false;
            return childSel === "*" || this.matches(childSel);
          }
          // Handle tag[attr="val"] or tag[attr]
          const attrMatch = s.match(/^([a-zA-Z0-9_-]*)\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/);
          if (attrMatch) {
            const [, tag, attr, val] = attrMatch;
            if (tag && this.localName !== tag.toLowerCase()) return false;
            if (!this.hasAttribute(attr)) return false;
            return val === undefined ? true : this.getAttribute(attr) === val;
          }
          if (s.startsWith("#")) return this.id === s.slice(1);
          if (s.startsWith(".")) return this.classList.contains(s.slice(1));
          return this.localName === s.toLowerCase();
        });
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        for (const ch of node.children) {
          if (ch.matches(sel)) out.push(ch);
          walk(ch);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
  }

  function notifyMutation(target, rec) {
    for (const obs of [...mutationObservers]) {
      if (!obs.active) continue;
      for (const { node, opts } of obs.targets) {
        const matchNode =
          node === target || (opts.subtree && node.contains(target));
        if (!matchNode) continue;
        if (rec.type === "childList" && !opts.childList) continue;
        if (rec.type === "attributes") {
          if (!opts.attributes) continue;
          if (
            Array.isArray(opts.attributeFilter) &&
            !opts.attributeFilter.includes(rec.attributeName)
          ) {
            continue;
          }
        }
        obs.queue.push({ ...rec, target });
        break;
      }
    }
  }

  function flushMutations() {
    for (const obs of [...mutationObservers]) {
      if (!obs.active || !obs.queue.length) continue;
      const batch = obs.queue.splice(0);
      obs.cb(batch, obs);
    }
  }

  // Build exact live Zen 1.24.1b DOM structure.
  const docRoot = new FakeElement("window", "main-window");
  const head = new FakeElement("head", "");
  docRoot.appendChild(head);

  const browserBox = new FakeElement("hbox", "browser");
  docRoot.appendChild(browserBox);

  // Firefox's hidden legacy stubs inside #sidebar-main and #browser!
  const sidebarMain = new FakeElement("box", "sidebar-main");
  sidebarMain.setRect({ left: 0, top: 0, width: 0, height: 0 });
  sidebarMain._computed = { display: "none" };
  const hiddenVerticalTabs = new FakeElement("box", "vertical-tabs");
  hiddenVerticalTabs.setRect({ left: 0, top: 0, width: 0, height: 0 });
  hiddenVerticalTabs._computed = { display: "none" };
  sidebarMain.appendChild(hiddenVerticalTabs);
  browserBox.appendChild(sidebarMain);

  const hiddenSidebarBox = new FakeElement("vbox", "sidebar-box");
  hiddenSidebarBox.setRect({ left: 0, top: 0, width: 0, height: 0 });
  hiddenSidebarBox._computed = { display: "none" };
  browserBox.appendChild(hiddenSidebarBox);

  // Real Zen sidebar chrome: #navigator-toolbox -> #TabsToolbar -> #TabsToolbar-customization-target
  const toolbox = new FakeElement("toolbox", "navigator-toolbox");
  const tabsToolbar = new FakeElement("toolbar", "TabsToolbar");
  const customTarget = new FakeElement("hbox", "TabsToolbar-customization-target");
  customTarget._computed = { display: "flex", flexDirection: "column" };

  const tabbrowserTabs = new FakeElement("tabs", "tabbrowser-tabs");
  tabbrowserTabs._computed = { display: "flex", flexDirection: "column", flexGrow: "1000" };
  const zenTabsWrapper = new FakeElement("vbox", "zen-tabs-wrapper");
  const arrowScrollbox = new FakeElement("arrowscrollbox", "tabbrowser-arrowscrollbox");

  // Workspace 0 (active)
  const ws0 = new FakeElement("zen-workspace", "zen-ws-0");
  ws0.setAttribute("active", "true");
  const ws0Pinned = new FakeElement("vbox", "");
  ws0Pinned.className = "zen-workspace-pinned-tabs-section";
  const ws0Normal = new FakeElement("vbox", "");
  ws0Normal.className = "zen-workspace-normal-tabs-section";
  const ws0Empty = new FakeElement("vbox", "");
  ws0Empty.className = "zen-workspace-empty-space";
  ws0.appendChild(ws0Pinned);
  ws0.appendChild(ws0Normal);
  ws0.appendChild(ws0Empty);

  // Populate ws0 with a folder + 4 tabs
  const ws0Folder = new FakeElement("zen-folder", "ws0-folder-1");
  ws0Pinned.appendChild(ws0Folder);
  const ws0Tabs = [];
  for (let i = 0; i < 4; i++) {
    const t = new FakeElement("tab", `ws0-tab-${i}`);
    t.className = "tabbrowser-tab";
    ws0Normal.appendChild(t);
    ws0Tabs.push(t);
  }

  // Workspace 1 (inactive, horizontally off-screen and full of tabs)
  const ws1 = new FakeElement("zen-workspace", "zen-ws-1");
  const ws1Pinned = new FakeElement("vbox", "");
  ws1Pinned.className = "zen-workspace-pinned-tabs-section";
  const ws1Normal = new FakeElement("vbox", "");
  ws1Normal.className = "zen-workspace-normal-tabs-section";
  const ws1Empty = new FakeElement("vbox", "");
  ws1Empty.className = "zen-workspace-empty-space";
  ws1.appendChild(ws1Pinned);
  ws1.appendChild(ws1Normal);
  ws1.appendChild(ws1Empty);
  const ws1Tabs = [];
  for (let i = 0; i < 26; i++) {
    const t = new FakeElement("tab", `ws1-tab-${i}`);
    t.className = "tabbrowser-tab";
    ws1Normal.appendChild(t);
    ws1Tabs.push(t);
  }

  arrowScrollbox.appendChild(ws0);
  arrowScrollbox.appendChild(ws1);
  zenTabsWrapper.appendChild(arrowScrollbox);
  tabbrowserTabs.appendChild(zenTabsWrapper);

  // Hidden #zen-media-controls-toolbar
  const mediaControls = new FakeElement("toolbar", "zen-media-controls-toolbar");
  mediaControls._computed = { display: "none" };
  mediaControls.setRect({ left: 0, top: 0, width: 0, height: 0 });

  // Optional #zentral-video-preview right after media controls
  const videoPreview = new FakeElement("div", "zentral-video-preview");

  // Flexible toolbarspring at bottom
  const spring = new FakeElement("toolbarspring", "zen-sidebar-spring");
  spring._computed = { display: "flex", flexGrow: "1" };

  customTarget.appendChild(tabbrowserTabs);
  customTarget.appendChild(mediaControls);
  if (options.includeVideoPreview !== false) {
    customTarget.appendChild(videoPreview);
  }
  customTarget.appendChild(spring);
  tabsToolbar.appendChild(customTarget);
  toolbox.appendChild(tabsToolbar);
  browserBox.appendChild(toolbox);

  // Live layout state (can be mutated by test scenarios)
  const state = {
    width: sidebarWidth,
    height: sidebarHeight,
    collapsed: false,
    activeWsIndex: 0,
    videoVisible: options.videoVisible !== false,
    videoHeight: Number.isFinite(options.videoHeight) ? options.videoHeight : 26,
    videoEnlarged: false,
    trayHeight: 0,
    overflowByWs: [false, true],
    occupiedByWs: [activeOccupiedHeight, inactiveOccupiedHeight],
    altVisibleVerticalTabs: false,
  };

  function syncLayout() {
    const w = state.collapsed ? 0 : state.width;
    const h = state.height;
    toolbox.setRect({ left: 0, top: 0, width: w, height: h });
    tabsToolbar.setRect({ left: 0, top: 0, width: w, height: h });
    customTarget.setRect({ left: 0, top: 0, width: w, height: h });
    toolbox._computed = state.collapsed ? { display: "none" } : { display: "flex" };

    const videoH =
      state.videoVisible && !state.videoEnlarged && videoPreview.isConnected
        ? state.videoHeight
        : 0;
    videoPreview.hidden = !state.videoVisible;
    if (state.videoEnlarged) {
      videoPreview.setAttribute("data-enlarged", "true");
      videoPreview.setRect({ left: 100, top: 100, width: 640, height: 360 });
    } else {
      videoPreview.removeAttribute("data-enlarged");
      videoPreview._computed = state.videoVisible
        ? { display: "flex" }
        : { display: "none" };
      videoPreview.setRect({
        left: 0,
        top: Math.max(0, h - videoH),
        width: state.videoVisible ? w : 0,
        height: videoH,
      });
    }

    const tabsH = Math.max(0, h - videoH - state.trayHeight);
    tabbrowserTabs.setRect({ left: 0, top: 0, width: w, height: tabsH });
    zenTabsWrapper.setRect({ left: 0, top: 0, width: w, height: tabsH });
    arrowScrollbox.setRect({ left: 0, top: 0, width: w, height: tabsH });

    const workspaces = [ws0, ws1];
    const emptyEls = [ws0Empty, ws1Empty];
    const tabGroups = [ws0Tabs, ws1Tabs];
    workspaces.forEach((ws, idx) => {
      const isActive = idx === state.activeWsIndex;
      if (isActive) {
        if (!ws.hasAttribute("active")) ws.setAttribute("active", "true");
      } else if (ws.hasAttribute("active")) {
        ws.removeAttribute("active");
      }
      const left = isActive ? 0 : w;
      const occupied = state.occupiedByWs[idx];
      const overflow = state.overflowByWs[idx] || occupied > tabsH;
      ws.setRect({ left, top: 0, width: w, height: tabsH });
      ws.scrollHeight = overflow ? Math.max(occupied, tabsH + 240) : tabsH;
      ws.clientHeight = tabsH;

      const tabs = tabGroups[idx];
      const step = tabs.length ? Math.floor(occupied / Math.max(1, tabs.length)) : 36;
      tabs.forEach((t, ti) => {
        t.setRect({ left, top: ti * step, width: w, height: Math.max(24, step - 4) });
      });
      if (idx === 0) {
        ws0Folder.setRect({ left, top: 0, width: w, height: 38 });
      }
      const emptyH = overflow ? 0 : Math.max(0, tabsH - occupied);
      emptyEls[idx].setRect({
        left,
        top: Math.min(tabsH, occupied),
        width: w,
        height: emptyH,
      });
      emptyEls[idx]._computed =
        emptyH > 0 ? { display: "flex", flexGrow: "1" } : { display: "none" };
    });

    const activeOverflow =
      state.overflowByWs[state.activeWsIndex] ||
      state.occupiedByWs[state.activeWsIndex] > tabsH;
    const activeOccupied = state.occupiedByWs[state.activeWsIndex];
    zenTabsWrapper.scrollHeight = activeOverflow
      ? Math.max(activeOccupied, tabsH + 200)
      : tabsH;
    arrowScrollbox.scrollHeight = zenTabsWrapper.scrollHeight;
    tabbrowserTabs.scrollHeight = zenTabsWrapper.scrollHeight;

    spring.setRect({ left: 0, top: tabsH, width: w, height: 0 });

    const tray = customTarget.querySelector("#zentral-sidebar-widgets");
    if (tray) {
      tray.setRect({
        left: 0,
        top: tabsH,
        width: w,
        height: state.trayHeight,
      });
    }

    if (state.altVisibleVerticalTabs) {
      sidebarMain._computed = { display: "flex" };
      sidebarMain.setRect({ left: 0, top: 0, width: w, height: h });
      hiddenVerticalTabs._computed = { display: "flex" };
      hiddenVerticalTabs.setRect({ left: 0, top: 0, width: w, height: tabsH });
    } else {
      sidebarMain._computed = { display: "none" };
      sidebarMain.setRect({ left: 0, top: 0, width: 0, height: 0 });
      hiddenVerticalTabs._computed = { display: "none" };
      hiddenVerticalTabs.setRect({ left: 0, top: 0, width: 0, height: 0 });
    }
  }

  syncLayout();

  let docVisibility = "visible";
  const doc = {
    documentElement: docRoot,
    head,
    body: null,
    get visibilityState() {
      return docVisibility;
    },
    get hidden() {
      return docVisibility !== "visible";
    },
    createElement(tag) {
      return new FakeElement(tag);
    },
    createXULElement(tag) {
      return new FakeElement(tag);
    },
    getElementById(id) {
      if (docRoot.id === id) return docRoot;
      const walk = (n) => {
        for (const c of n.children) {
          if (c.id === id) return c;
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(docRoot);
    },
    querySelector(sel) {
      return docRoot.querySelector(sel);
    },
    querySelectorAll(sel) {
      return docRoot.querySelectorAll(sel);
    },
    addEventListener(type, fn, opts) {
      docListeners.push([type, fn, opts]);
    },
    removeEventListener(type, fn, opts) {
      const i = docListeners.findIndex((x) => x[0] === type && x[1] === fn);
      if (i >= 0) docListeners.splice(i, 1);
    },
  };

  function getPrefRaw(name) {
    return prefs.has(name) ? prefs.get(name) : undefined;
  }

  const Services = {
    prefs: {
      getBoolPref(name, def) {
        const v = getPrefRaw(name);
        return typeof v === "boolean" ? v : def;
      },
      getIntPref(name, def) {
        const v = getPrefRaw(name);
        return typeof v === "number" ? v : def;
      },
      getStringPref(name, def) {
        const v = getPrefRaw(name);
        return typeof v === "string" ? v : def;
      },
      setBoolPref(name, val) {
        prefs.set(name, Boolean(val));
        notifyPref(name);
      },
      setIntPref(name, val) {
        prefs.set(name, Number(val));
        notifyPref(name);
      },
      setStringPref(name, val) {
        prefs.set(name, String(val));
        notifyPref(name);
      },
      addObserver(branch, obs) {
        prefObservers.push([branch, obs]);
      },
      removeObserver(branch, obs) {
        const i = prefObservers.findIndex((x) => x[0] === branch && x[1] === obs);
        if (i >= 0) prefObservers.splice(i, 1);
      },
    },
  };

  function notifyPref(name) {
    for (const [branch, obs] of [...prefObservers]) {
      if (name.startsWith(branch)) {
        if (typeof obs === "function") obs(null, "nsPref:changed", name);
        else obs?.observe?.(null, "nsPref:changed", name);
      }
    }
  }

  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.targets = [];
      this.queue = [];
      this.active = true;
      mutationObservers.push(this);
    }
    observe(node, opts = {}) {
      this.targets.push({ node, opts });
    }
    disconnect() {
      this.active = false;
      this.targets = [];
      this.queue = [];
    }
  }

  class FakeResizeObserver {
    constructor(cb) {
      this.cb = cb;
      this.targets = new Set();
      this.active = true;
      resizeObservers.push(this);
    }
    observe(node) {
      this.targets.add(node);
    }
    unobserve(node) {
      this.targets.delete(node);
    }
    disconnect() {
      this.active = false;
      this.targets.clear();
    }
  }

  const gBrowser = {
    tabContainer: {
      addEventListener(type, fn) {
        tabListeners.push([type, fn]);
      },
      removeEventListener(type, fn) {
        const i = tabListeners.findIndex((x) => x[0] === type && x[1] === fn);
        if (i >= 0) tabListeners.splice(i, 1);
      },
    },
  };

  const win = {
    document: doc,
    Services,
    gBrowser,
    gNavToolbox: toolbox,
    innerWidth: windowWidth,
    innerHeight: windowHeight,
    MutationObserver: FakeMutationObserver,
    ResizeObserver: FakeResizeObserver,
    getComputedStyle(el) {
      return {
        display: el?._computed?.display || "block",
        visibility: el?._computed?.visibility || "visible",
        flexDirection: el?._computed?.flexDirection || "",
        flexGrow: el?._computed?.flexGrow || "0",
      };
    },
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      timers.set(id, { fn, at: nowMs + Math.max(0, Number(ms) || 0), ms: Number(ms) || 0 });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(fn) {
      const id = nextRafId++;
      rafs.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      rafs.delete(id);
    },
    addEventListener(type, fn, opts) {
      winListeners.push([type, fn, opts]);
    },
    removeEventListener(type, fn, opts) {
      const i = winListeners.findIndex((x) => x[0] === type && x[1] === fn);
      if (i >= 0) winListeners.splice(i, 1);
    },
  };
  win.window = win;

  function flushRafs() {
    let guard = 0;
    while (rafs.size && guard++ < 20) {
      const batch = Array.from(rafs.entries());
      rafs.clear();
      for (const [, fn] of batch) fn(nowMs);
    }
  }

  function advanceMs(delta) {
    const target = nowMs + delta;
    let guard = 0;
    while (guard++ < 500) {
      let earliestId = null;
      let earliestAt = Infinity;
      for (const [id, t] of timers.entries()) {
        if (t.at <= target && t.at < earliestAt) {
          earliestAt = t.at;
          earliestId = id;
        }
      }
      if (earliestId == null) break;
      const t = timers.get(earliestId);
      timers.delete(earliestId);
      nowMs = Math.max(nowMs, t.at);
      t.fn();
      flushMutations();
      flushRafs();
    }
    nowMs = target;
    flushMutations();
    flushRafs();
  }

  function triggerResize() {
    for (const ro of [...resizeObservers]) {
      if (ro.active) ro.cb([], ro);
    }
    for (const [type, fn] of [...winListeners]) {
      if (type === "resize") fn({ type: "resize" });
    }
    flushRafs();
  }

  return {
    win,
    doc,
    Services,
    FakeElement,
    elements: {
      docRoot,
      browserBox,
      sidebarMain,
      hiddenVerticalTabs,
      hiddenSidebarBox,
      toolbox,
      tabsToolbar,
      customTarget,
      tabbrowserTabs,
      zenTabsWrapper,
      arrowScrollbox,
      ws0,
      ws0Empty,
      ws1,
      ws1Empty,
      mediaControls,
      videoPreview,
      spring,
    },
    state,
    timers,
    rafs,
    winListeners,
    docListeners,
    tabListeners,
    mutationObservers,
    resizeObservers,
    getNow: () => nowMs,
    setNow: (ms) => {
      nowMs = ms;
    },
    setVisibility(vis) {
      docVisibility = vis;
      for (const [type, fn] of [...docListeners]) {
        if (type === "visibilitychange") fn({ type: "visibilitychange" });
      }
      flushRafs();
    },
    setTrayRenderedHeight(px) {
      state.trayHeight = Math.max(0, Number(px) || 0);
      syncLayout();
    },
    setSidebarWidth(w) {
      state.width = Math.max(0, Number(w) || 0);
      syncLayout();
      triggerResize();
    },
    setSidebarCollapsed(collapsed) {
      state.collapsed = Boolean(collapsed);
      if (state.collapsed) {
        docRoot.setAttribute("zen-sidebar-collapsed", "true");
      } else {
        docRoot.removeAttribute("zen-sidebar-collapsed");
      }
      syncLayout();
      flushMutations();
      triggerResize();
    },
    setOverflow(wsIndex, overflow) {
      state.overflowByWs[wsIndex] = Boolean(overflow);
      syncLayout();
      triggerResize();
    },
    setOccupiedHeight(wsIndex, px) {
      state.occupiedByWs[wsIndex] = Math.max(0, Number(px) || 0);
      syncLayout();
      triggerResize();
    },
    switchWorkspace(wsIndex) {
      state.activeWsIndex = wsIndex;
      syncLayout();
      flushMutations();
      flushRafs();
    },
    setVideoPreview({ visible, height, enlarged } = {}) {
      if (visible !== undefined) state.videoVisible = Boolean(visible);
      if (height !== undefined) state.videoHeight = Math.max(0, Number(height) || 0);
      if (enlarged !== undefined) state.videoEnlarged = Boolean(enlarged);
      syncLayout();
      flushMutations();
      triggerResize();
    },
    toggleAltFirefoxVerticalTabs(enabled) {
      state.altVisibleVerticalTabs = Boolean(enabled);
      if (state.altVisibleVerticalTabs) {
        // Move tabbrowserTabs into visible #vertical-tabs (Firefox/alt-Zen layout)
        hiddenVerticalTabs.appendChild(tabbrowserTabs);
        customTarget.remove();
        tabsToolbar.appendChild(hiddenVerticalTabs);
      } else {
        customTarget.insertBefore(tabbrowserTabs, customTarget.children[0] || null);
        tabsToolbar.appendChild(customTarget);
        sidebarMain.appendChild(hiddenVerticalTabs);
      }
      syncLayout();
      flushMutations();
      triggerResize();
    },
    syncLayout,
    flushMutations,
    flushRafs,
    advanceMs,
    triggerResize,
  };
}

module.exports = {
  createRealZenSidebarHarness,
};
