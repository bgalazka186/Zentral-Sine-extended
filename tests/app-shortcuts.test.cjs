/*
 * T3.10 — Custom keyboard shortcut for opening/toggling a Zentral app or panel.
 * Exercises extension/panels/interaction/ZentralAppShortcuts.js in a fake browser
 * window + verifies settings catalog, layout, and ZP/ZFS wiring.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(rootDir, rel), "utf8");

function createFakeDom({ keys = [], isMac = false } = {}) {
  const listeners = new Map();
  const byId = new Map();

  function makeEl(tag, ns = "http://www.w3.org/1999/xhtml") {
    const attrs = new Map();
    const elListeners = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      namespaceURI: ns,
      id: "",
      className: "",
      textContent: "",
      title: "",
      type: "",
      tabIndex: -1,
      disabled: false,
      hidden: false,
      style: {},
      dataset: {},
      children: [],
      parentNode: null,
      isConnected: false,
      setAttribute(k, v) {
        const s = String(v);
        attrs.set(k, s);
        if (k === "id") {
          if (el.id) byId.delete(el.id);
          el.id = s;
          if (el.isConnected && s) byId.set(s, el);
        } else if (k === "disabled") {
          el.disabled = s !== "false";
        }
      },
      getAttribute(k) {
        if (k === "id" && el.id) return el.id;
        return attrs.has(k) ? attrs.get(k) : null;
      },
      hasAttribute(k) {
        return attrs.has(k);
      },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === "disabled") el.disabled = false;
      },
      appendChild(child) {
        if (!child) return child;
        if (child.parentNode) child.remove();
        child.parentNode = el;
        el.children.push(child);
        markConnected(child, el.isConnected);
        return child;
      },
      append(...nodes) {
        for (const n of nodes) el.appendChild(n);
      },
      replaceChildren(...nodes) {
        for (const c of el.children.slice()) c.remove();
        for (const n of nodes) el.appendChild(n);
      },
      insertAdjacentElement(pos, node) {
        if (!el.parentNode) return null;
        if (node.parentNode) node.remove();
        const siblings = el.parentNode.children;
        const idx = siblings.indexOf(el);
        const insertAt = pos === "afterend" ? idx + 1 : idx;
        node.parentNode = el.parentNode;
        siblings.splice(insertAt, 0, node);
        markConnected(node, el.parentNode.isConnected);
        return node;
      },
      remove() {
        if (!el.parentNode) return;
        const arr = el.parentNode.children;
        const idx = arr.indexOf(el);
        if (idx >= 0) arr.splice(idx, 1);
        el.parentNode = null;
        markConnected(el, false);
      },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        const match = (node) => {
          if (sel.startsWith("#")) return node.id === sel.slice(1);
          if (sel.startsWith("."))
            return String(node.className || "")
              .split(/\s+/)
              .includes(sel.slice(1));
          return node.tagName.toLowerCase() === sel.toLowerCase();
        };
        const walk = (node) => {
          for (const c of node.children) {
            if (match(c)) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      },
      closest(sel) {
        let cur = el;
        while (cur) {
          if (sel === "#zentral-video-preview[data-enlarged]") {
            if (cur.id === "zentral-video-preview" && cur.hasAttribute("data-enlarged"))
              return cur;
          }
          cur = cur.parentNode;
        }
        return null;
      },
      addEventListener(type, fn) {
        if (!elListeners.has(type)) elListeners.set(type, new Set());
        elListeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        elListeners.get(type)?.delete(fn);
      },
      dispatchEvent(ev) {
        ev.target = ev.target || el;
        for (const fn of [...(elListeners.get(ev.type) || [])]) fn(ev);
        return !ev.defaultPrevented;
      },
      click() {
        el.dispatchEvent({ type: "click", target: el });
      },
      focus() {
        document.activeElement = el;
      },
    };
    return el;
  }

  function markConnected(node, connected) {
    node.isConnected = connected;
    if (node.id) {
      if (connected) byId.set(node.id, node);
      else if (byId.get(node.id) === node) byId.delete(node.id);
    }
    for (const c of node.children) markConnected(c, connected);
  }

  const rootEl = makeEl("window");
  rootEl.isConnected = true;
  rootEl.setAttribute("id", "main-window");

  const browserEl = makeEl("div");
  browserEl.setAttribute("id", "browser");
  rootEl.appendChild(browserEl);

  const panelRoot = makeEl("div");
  panelRoot.setAttribute("id", "zen-app-panel-root");
  browserEl.appendChild(panelRoot);

  const keyset = makeEl("keyset", "xul");
  for (const k of keys) {
    const keyEl = makeEl("key", "xul");
    for (const [ak, av] of Object.entries(k)) keyEl.setAttribute(ak, av);
    keyset.appendChild(keyEl);
  }
  rootEl.appendChild(keyset);

  const popup = makeEl("menupopup", "xul");
  popup.setAttribute("id", "zen-apps-sidebar-tile-context");
  const preloadItem = makeEl("menuitem", "xul");
  preloadItem.setAttribute("id", "zen-apps-sidebar-preload-item");
  popup.appendChild(preloadItem);
  const startupMenu = makeEl("menu", "xul");
  startupMenu.setAttribute("id", "zen-apps-sidebar-open-startup-menu");
  popup.appendChild(startupMenu);
  rootEl.appendChild(popup);

  const document = {
    documentElement: rootEl,
    body: browserEl,
    activeElement: null,
    createElement: (tag) => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag, ns),
    createXULElement: (tag) => makeEl(tag, "xul"),
    getElementById: (id) => byId.get(id) || null,
    querySelectorAll: (sel) => rootEl.querySelectorAll(sel),
    querySelector: (sel) => rootEl.querySelector(sel),
  };

  class FakeCustomEvent {
    constructor(type, opts = {}) {
      this.type = type;
      this.detail = opts.detail;
      this.defaultPrevented = false;
    }
  }

  const window = {
    document,
    navigator: { platform: isMac ? "MacIntel" : "Linux x86_64", userAgent: "" },
    CustomEvent: FakeCustomEvent,
    Zentral: {},
    addEventListener(type, fn, capture = false) {
      const key = `${type}:${!!capture}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    },
    removeEventListener(type, fn, capture = false) {
      const key = `${type}:${!!capture}`;
      const arr = listeners.get(key);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(ev) {
      // Fire capture listeners first, then bubble listeners (matching DOM order).
      let stoppedImmediate = false;
      ev.preventDefault = () => {
        ev.defaultPrevented = true;
      };
      ev.stopPropagation = () => {
        ev.propagationStopped = true;
      };
      ev.stopImmediatePropagation = () => {
        ev.propagationStopped = true;
        stoppedImmediate = true;
      };
      for (const cap of [true, false]) {
        const arr = [...(listeners.get(`${ev.type}:${cap}`) || [])];
        for (const fn of arr) {
          if (stoppedImmediate) break;
          fn(ev);
        }
        if (stoppedImmediate) break;
      }
      return !ev.defaultPrevented;
    },
  };
  window.window = window;

  return { window, document, popup, panelRoot, rootEl, makeEl };
}

function makeKeyEvent({
  key = "",
  code = "",
  ctrlKey = false,
  altKey = false,
  shiftKey = false,
  metaKey = false,
  repeat = false,
  isComposing = false,
} = {}) {
  return {
    type: "keydown",
    key,
    code,
    ctrlKey,
    altKey,
    shiftKey,
    metaKey,
    repeat,
    isComposing,
    defaultPrevented: false,
  };
}

function createHarness({
  prefs: initialPrefs = {},
  apps = [],
  essentialPanels = new Map(),
  domKeys = [],
  zenManagerShortcuts = null,
  isMac = false,
} = {}) {
  const { window, document, popup, panelRoot, rootEl, makeEl } = createFakeDom({
    keys: domKeys,
    isMac,
  });

  const prefStore = new Map(Object.entries({
    "zen.workspace.apps.sidebar.enabled": true,
    "zen.workspace.apps.sidebar.apps": JSON.stringify(apps),
    "zen.workspace.bgalazka.app_shortcuts": "{}",
    "zen.workspace.zentral.notes.enabled": true,
    "zen.workspace.zentral.notes.shortcut": "Alt+Shift+N",
    "zen.workspace.zentral.notes.shortcuts": "{}",
    "zen.workspace.apps.insta_peek.shortcut": "Alt+Q",
    ...initialPrefs,
  }));

  const getPref = (k, def) => (prefStore.has(k) ? prefStore.get(k) : def);
  const setPref = (k, v) => prefStore.set(k, v);

  const calls = [];
  let activeAppId = null;

  window.Zentral.Apps = {
    getPanelSnapshot() {
      return {
        appId: activeAppId,
        root: panelRoot,
      };
    },
    openPanel(app) {
      calls.push({ op: "openPanel", id: app.id });
      activeAppId = app.id;
      panelRoot.setAttribute("open", "true");
      panelRoot.removeAttribute("closing");
    },
    closePanel() {
      calls.push({ op: "closePanel", prev: activeAppId });
      activeAppId = null;
      panelRoot.removeAttribute("open");
    },
  };

  if (zenManagerShortcuts) {
    window.gZenKeyboardShortcutsManager = {
      _currentShortcutList: zenManagerShortcuts,
    };
  }

  const ctx = {
    essentialPanels,
    setHoverPanelHidden(hidden) {
      calls.push({ op: "setHoverPanelHidden", hidden });
      if (hidden) rootEl.setAttribute("bgalazka-hover-panel-hidden", "true");
      else rootEl.removeAttribute("bgalazka-hover-panel-hidden");
    },
    getActiveAppBrowser: () => (activeAppId ? { _bgalazkaAppId: activeAppId } : null),
  };

  const cleanups = [];
  const registerCleanup = (fn) => cleanups.push(fn);

  const factories = new Map();
  window.ZentralModuleLoader = {
    define(id, fn) {
      factories.set(id, fn);
    },
  };

  const src = read("extension/panels/interaction/ZentralAppShortcuts.js");
  vm.runInNewContext(src, {
    window,
    document,
    navigator: window.navigator,
    CustomEvent: window.CustomEvent,
    URL,
    JSON,
    Map,
    Set,
    Object,
    Array,
    String,
    Boolean,
    RegExp,
    console,
  });

  const BGALAZKA_EXT_PREFS = {
    APP_SHORTCUTS: "zen.workspace.bgalazka.app_shortcuts",
    KEYBIND_OPEN_SETTINGS: "zen.workspace.bgalazka.keybind.open_settings",
    KEYBIND_TOGGLE_PIN: "zen.workspace.bgalazka.keybind.toggle_pin",
  };
  const EXT_KEYBIND_DEFAULTS = {
    OPEN_SETTINGS: "Ctrl+Shift+Comma",
    TOGGLE_PIN: "Ctrl+Shift+P",
  };
  const EXT_KEYBIND_ACTIONS = [
    { key: "OPEN_SETTINGS", pref: BGALAZKA_EXT_PREFS.KEYBIND_OPEN_SETTINGS },
    { key: "TOGGLE_PIN", pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_PIN },
  ];

  const api = factories.get("panels/ZentralAppShortcuts")({
    BGALAZKA_EXT_PREFS,
    EXT_KEYBIND_ACTIONS,
    EXT_KEYBIND_DEFAULTS,
    ctx,
    getPref,
    setPref,
    registerCleanup,
  });

  return {
    api,
    ctx,
    window,
    document,
    popup,
    panelRoot,
    rootEl,
    prefStore,
    calls,
    makeEl,
    setActiveApp(id) {
      activeAppId = id;
    },
    cleanup() {
      for (const fn of cleanups.splice(0).reverse()) fn();
    },
  };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("  PASS:", name);
}

console.log("Running T3.10 app-shortcuts tests...");

test("1. Canonical parsing, formatting, >=2 keys validation & layout-independent matching", () => {
  const h = createHarness();
  const { api } = h;

  // Rejects bare single keys and lone modifiers
  assert.equal(api.validateAppShortcut("I").valid, false);
  assert.equal(api.validateAppShortcut("F5").valid, false);
  assert.equal(api.validateAppShortcut("Escape").valid, false);
  assert.equal(api.validateAppShortcut("Shift+I").valid, false, "Shift-only must be rejected");
  assert.equal(api.validateAppShortcut("Alt").valid, false);

  const modOnly = api.comboFromEvent(makeKeyEvent({ key: "Alt", altKey: true, shiftKey: true }));
  assert.equal(modOnly.isModifierOnly, true);
  assert.deepEqual([...modOnly.heldModifiers], ["Alt", "Shift"]);

  const bareSingle = api.comboFromEvent(makeKeyEvent({ key: "i", code: "KeyI" }));
  assert.equal(bareSingle.combo, "");
  assert.match(bareSingle.error, /at least 2 keys/i);

  // Accepts valid 2+ key combos and normalizes layout-independently (Shift+1 -> "!" key, Digit1 code)
  const shiftDigit = api.comboFromEvent(
    makeKeyEvent({ key: "!", code: "Digit1", altKey: true, shiftKey: true }),
  );
  assert.equal(shiftDigit.combo, "Alt+Shift+1");
  assert.equal(shiftDigit.error, null);

  // Alias normalization + macOS Accel handling
  assert.equal(api.normalizeCombo("shift+option+i", false), "Alt+Shift+I");
  assert.equal(api.normalizeCombo("accel+alt+k", false), "Ctrl+Alt+K");
  assert.equal(api.normalizeCombo("accel+alt+k", true), "Alt+Meta+K");

  // Matching via e.code even under alternate layout key output
  assert.equal(
    api.matchesShortcut(
      makeKeyEvent({ key: "İ", code: "KeyI", altKey: true, shiftKey: true }),
      "Alt+Shift+I",
    ),
    true,
  );
  assert.equal(
    api.matchesShortcut(
      makeKeyEvent({ key: "i", code: "KeyI", ctrlKey: true, altKey: true, shiftKey: true }),
      "Alt+Shift+I",
    ),
    false,
  );

  h.cleanup();
});

test("2. Collision refusal across Zen/Firefox, DOM <key>, Zen Manager, Notes, Insta-Peek, Panel Keybinds & Other Apps", () => {
  const h = createHarness({
    apps: [
      { id: "ig", name: "Instagram", url: "https://instagram.com" },
      { id: "sp", name: "Spotify", url: "https://open.spotify.com" },
    ],
    prefs: {
      "zen.workspace.zentral.notes.shortcuts": JSON.stringify({
        capturePage: "Alt+Shift+C",
      }),
    },
    domKeys: [
      { id: "key_custom_zen_split", modifiers: "alt,shift", key: "Z" },
      { id: "key_disabled_one", modifiers: "alt,shift", key: "D", disabled: "true" },
    ],
    zenManagerShortcuts: [
      { id: "zen-custom-glance", modifiers: { alt: true, shift: true }, key: "G" },
    ],
  });
  const { api } = h;

  // Baseline Firefox & Zen browser shortcuts refused
  const ctrlT = api.setAppShortcut("ig", "Ctrl+T");
  assert.equal(ctrlT.ok, false);
  assert.match(ctrlT.reason, /New Tab/i);

  const zenCompact = api.setAppShortcut("ig", "Ctrl+Alt+S");
  assert.equal(zenCompact.ok, false);
  assert.match(zenCompact.reason, /Compact Mode/i);

  // Live DOM <key> element refused; disabled DOM <key> allowed
  assert.equal(api.setAppShortcut("ig", "Alt+Shift+Z").ok, false);
  assert.equal(api.findShortcutConflict("Alt+Shift+D"), null);

  // Live gZenKeyboardShortcutsManager shortcut refused
  const zenMgr = api.setAppShortcut("ig", "Alt+Shift+G");
  assert.equal(zenMgr.ok, false);
  assert.match(zenMgr.reason, /zen-custom-glance/i);

  // Zentral Notes global shortcut (default Alt+Shift+N) & Notes global action (Alt+Shift+C) refused
  const notesConflict = api.setAppShortcut("ig", "Alt+Shift+N");
  assert.equal(notesConflict.ok, false);
  assert.match(notesConflict.reason, /Notes/i);

  const notesActionConflict = api.setAppShortcut("ig", "Alt+Shift+C");
  assert.equal(notesActionConflict.ok, false);
  assert.match(notesActionConflict.reason, /Notes/i);

  // Zentral Insta-Peek (Alt+Q) refused
  const peekConflict = api.setAppShortcut("ig", "Alt+Q");
  assert.equal(peekConflict.ok, false);
  assert.match(peekConflict.reason, /Insta-Peek/i);

  // Zentral Extension Panel keybind (Ctrl+Shift+Comma) refused
  const panelKeybindConflict = api.setAppShortcut("ig", "Ctrl+Shift+Comma");
  assert.equal(panelKeybindConflict.ok, false);
  assert.match(panelKeybindConflict.reason, /Open Zentral Settings/i);

  // Valid free combo succeeds for Instagram
  const ok = api.setAppShortcut("ig", "Alt+Shift+I");
  assert.equal(ok.ok, true);
  assert.equal(ok.combo, "Alt+Shift+I");

  // Re-assigning same combo to Instagram itself is allowed (no self-conflict)
  assert.equal(api.setAppShortcut("ig", "Alt+Shift+I").ok, true);

  // Assigning same combo to Spotify is refused and names Instagram
  const otherApp = api.setAppShortcut("sp", "Alt+Shift+I");
  assert.equal(otherApp.ok, false);
  assert.match(otherApp.reason, /Instagram/);

  h.cleanup();
});

test("3. Tile context menu shows Add, displays current shortcut, and removes shortcut", () => {
  const h = createHarness({
    apps: [{ id: "ig", name: "Instagram", url: "https://instagram.com" }],
  });
  const { api, window, popup } = h;

  // Empty sidebar click -> hidden
  popup.dataset.activeAppId = "";
  window.dispatchEvent({ type: "popupshowing", target: popup });
  const assignItem = popup.querySelector("#" + api.CTX_ASSIGN_ID);
  const removeItem = popup.querySelector("#" + api.CTX_REMOVE_ID);
  assert.ok(assignItem && removeItem);
  assert.equal(assignItem.hidden, true);
  assert.equal(removeItem.hidden, true);

  // Right-click unassigned Instagram -> "Add custom keyboard shortcut", remove hidden
  popup.dataset.activeAppId = "ig";
  window.dispatchEvent({ type: "popupshowing", target: popup });
  assert.equal(assignItem.hidden, false);
  assert.equal(assignItem.getAttribute("label"), "Add custom keyboard shortcut");
  assert.equal(removeItem.hidden, true);

  // Assign shortcut -> context menu displays it and reveals Remove option
  assert.equal(api.setAppShortcut("ig", "Alt+Shift+I").ok, true);
  window.dispatchEvent({ type: "popupshowing", target: popup });
  assert.equal(assignItem.hidden, false);
  assert.equal(assignItem.getAttribute("label"), "Custom shortcut: Alt+Shift+I");
  assert.equal(removeItem.hidden, false);
  assert.equal(removeItem.getAttribute("label"), "Remove custom shortcut (Alt+Shift+I)");

  // Trigger Remove command in context menu -> clears pref & hides Remove on next open
  let changeEvents = 0;
  window.addEventListener(api.CHANGED_EVENT, () => changeEvents++);
  removeItem.dispatchEvent({ type: "command" });
  assert.equal(api.getAppShortcut("ig"), "");
  assert.equal(changeEvents, 1);

  window.dispatchEvent({ type: "popupshowing", target: popup });
  assert.equal(assignItem.getAttribute("label"), "Add custom keyboard shortcut");
  assert.equal(removeItem.hidden, true);

  h.cleanup();
});

test("4. Shortcut recorder prompt rejects single key & collisions, saves valid combo, supports Remove & Escape", () => {
  const h = createHarness({
    apps: [{ id: "ig", name: "Instagram", url: "https://instagram.com" }],
  });
  const { api, window, document, popup } = h;

  // Open prompt via context menu command
  popup.dataset.activeAppId = "ig";
  window.dispatchEvent({ type: "popupshowing", target: popup });
  popup.querySelector("#" + api.CTX_ASSIGN_ID).dispatchEvent({ type: "command" });

  assert.equal(api.isPromptOpen(), true);
  const promptEl = document.getElementById(api.PROMPT_ID);
  assert.ok(promptEl);
  const saveBtn = promptEl.querySelector(".zas-btn-save");
  const statusEl = promptEl.querySelector(".zas-status");
  assert.equal(saveBtn.disabled, true);

  // 1) Bare single key -> refused, Save stays disabled
  const evSingle = makeKeyEvent({ key: "i", code: "KeyI" });
  window.dispatchEvent(evSingle);
  assert.equal(evSingle.defaultPrevented, true);
  assert.equal(saveBtn.disabled, true);
  assert.equal(statusEl.dataset.tone, "error");

  // 2) Colliding Firefox shortcut (Ctrl+T) -> refused & prevented from opening a tab
  const evCtrlT = makeKeyEvent({ key: "t", code: "KeyT", ctrlKey: true });
  window.dispatchEvent(evCtrlT);
  assert.equal(evCtrlT.defaultPrevented, true);
  assert.equal(saveBtn.disabled, true);
  assert.match(statusEl.textContent, /New Tab/i);

  // 3) Colliding Notes shortcut (Alt+Shift+N) -> refused
  window.dispatchEvent(makeKeyEvent({ key: "N", code: "KeyN", altKey: true, shiftKey: true }));
  assert.equal(saveBtn.disabled, true);
  assert.match(statusEl.textContent, /Notes/i);

  // 4) Valid free combo (Alt+Shift+I) -> enables Save; Enter commits and closes prompt
  window.dispatchEvent(makeKeyEvent({ key: "I", code: "KeyI", altKey: true, shiftKey: true }));
  assert.equal(saveBtn.disabled, false);
  assert.equal(statusEl.dataset.tone, "valid");

  window.dispatchEvent(makeKeyEvent({ key: "Enter", code: "Enter" }));
  assert.equal(api.isPromptOpen(), false);
  assert.equal(api.getAppShortcut("ig"), "Alt+Shift+I");

  // 5) Re-open prompt -> Escape cancels without deleting; re-open & click Remove clears it
  api.openShortcutPrompt("ig", "Instagram");
  window.dispatchEvent(makeKeyEvent({ key: "Escape", code: "Escape" }));
  assert.equal(api.isPromptOpen(), false);
  assert.equal(api.getAppShortcut("ig"), "Alt+Shift+I");

  api.openShortcutPrompt("ig", "Instagram");
  const removeBtn = document.getElementById(api.PROMPT_ID).querySelector(".zas-btn-remove");
  assert.ok(removeBtn);
  removeBtn.click();
  assert.equal(api.isPromptOpen(), false);
  assert.equal(api.getAppShortcut("ig"), "");

  h.cleanup();
});

test("5. Global keydown toggles app visibility (reveal hidden, hide shown, switch app, hover-hidden, essential panel, guards)", () => {
  const essentialPanels = new Map([
    [
      "ess-mail",
      {
        tab: { isConnected: true },
        app: { id: "ess-mail", name: "Mail Essential", url: "https://mail.example" },
      },
    ],
  ]);
  const h = createHarness({
    apps: [
      { id: "ig", name: "Instagram", url: "https://instagram.com" },
      { id: "sp", name: "Spotify", url: "https://open.spotify.com" },
    ],
    essentialPanels,
  });
  const { api, window, document, rootEl, calls, makeEl } = h;

  assert.equal(api.setAppShortcut("ig", "Alt+Shift+I").ok, true);
  assert.equal(api.setAppShortcut("ess-mail", "Alt+Shift+M").ok, true);

  // 1) Hidden -> pressing Alt+Shift+I reveals Instagram
  const ev1 = makeKeyEvent({ key: "I", code: "KeyI", altKey: true, shiftKey: true });
  window.dispatchEvent(ev1);
  assert.equal(ev1.defaultPrevented, true);
  assert.deepEqual(calls.at(-1), { op: "openPanel", id: "ig" });
  assert.equal(api.isAppVisible("ig"), true);

  // 2) Repeat keydown is ignored (no rapid flicker)
  const countBeforeRepeat = calls.length;
  window.dispatchEvent(
    makeKeyEvent({ key: "I", code: "KeyI", altKey: true, shiftKey: true, repeat: true }),
  );
  assert.equal(calls.length, countBeforeRepeat);

  // 3) Currently shown -> pressing Alt+Shift+I again hides it
  window.dispatchEvent(makeKeyEvent({ key: "I", code: "KeyI", altKey: true, shiftKey: true }));
  assert.deepEqual(calls.at(-1), { op: "closePanel", prev: "ig" });
  assert.equal(api.isAppVisible("ig"), false);

  // 4) Another app (Spotify) is open -> pressing Alt+Shift+I reveals Instagram
  window.Zentral.Apps.openPanel({ id: "sp", name: "Spotify" });
  assert.equal(api.isAppVisible("sp"), true);
  assert.equal(api.isAppVisible("ig"), false);
  window.dispatchEvent(makeKeyEvent({ key: "I", code: "KeyI", altKey: true, shiftKey: true }));
  assert.deepEqual(calls.at(-1), { op: "openPanel", id: "ig" });
  assert.equal(api.isAppVisible("ig"), true);

  // 5) Hover-hidden while Instagram is active -> pressing Alt+Shift+I reveals via setHoverPanelHidden(false)
  rootEl.setAttribute("bgalazka-hover-panel-hidden", "true");
  assert.equal(api.isAppVisible("ig"), false);
  window.dispatchEvent(makeKeyEvent({ key: "I", code: "KeyI", altKey: true, shiftKey: true }));
  assert.deepEqual(calls.at(-1), { op: "setHoverPanelHidden", hidden: false });
  assert.equal(api.isAppVisible("ig"), true);

  // 6) Essential panel toggle works identically
  window.dispatchEvent(makeKeyEvent({ key: "M", code: "KeyM", altKey: true, shiftKey: true }));
  assert.deepEqual(calls.at(-1), { op: "openPanel", id: "ess-mail" });
  window.dispatchEvent(makeKeyEvent({ key: "M", code: "KeyM", altKey: true, shiftKey: true }));
  assert.deepEqual(calls.at(-1), { op: "closePanel", prev: "ess-mail" });

  // 7) Guards: Settings keybind recording & enlarged video preview suppress global toggle
  const recInput = makeEl("input");
  recInput.dataset.recording = "true";
  document.activeElement = recInput;
  const beforeRec = calls.length;
  window.dispatchEvent(makeKeyEvent({ key: "I", code: "KeyI", altKey: true, shiftKey: true }));
  assert.equal(calls.length, beforeRec);
  document.activeElement = null;

  const videoEl = makeEl("div");
  videoEl.setAttribute("id", "zentral-video-preview");
  videoEl.setAttribute("data-enlarged", "true");
  rootEl.appendChild(videoEl);
  document.activeElement = videoEl;
  window.dispatchEvent(makeKeyEvent({ key: "I", code: "KeyI", altKey: true, shiftKey: true }));
  assert.equal(calls.length, beforeRec);
  document.activeElement = null;
  videoEl.remove();

  // 8) listKnownApps includes sidebar, essential, and orphaned saved shortcuts
  h.prefStore.set(
    "zen.workspace.bgalazka.app_shortcuts",
    JSON.stringify({ ig: "Alt+Shift+I", "removed-app": "Alt+Shift+R" }),
  );
  const listed = api.listKnownApps();
  assert.ok(listed.some((a) => a.id === "ig" && a.shortcut === "Alt+Shift+I"));
  assert.ok(listed.some((a) => a.id === "ess-mail" && a.kind === "essential"));
  assert.ok(listed.some((a) => a.id === "removed-app" && a.unavailable && a.shortcut === "Alt+Shift+R"));

  // 9) Cleanup detaches listeners and removes menu items & ctx export
  h.cleanup();
  assert.equal(h.ctx.appShortcuts, undefined);
  const afterCleanup = calls.length;
  window.dispatchEvent(makeKeyEvent({ key: "I", code: "KeyI", altKey: true, shiftKey: true }));
  assert.equal(calls.length, afterCleanup);
});

test("6. Wiring, Settings catalog, layout, and FeatureSettings UI contract", () => {
  const panelsSrc = read("extension/panels/ZentralPanels.uc.js");
  assert.match(panelsSrc, /APP_SHORTCUTS:\s*"zen\.workspace\.bgalazka\.app_shortcuts"/);
  assert.match(panelsSrc, /extension\/panels\/interaction\/ZentralAppShortcuts\.js/);
  assert.match(panelsSrc, /panels\/ZentralAppShortcuts/);
  assert.match(panelsSrc, /ctx\.appShortcuts\?\.isPromptOpen\?\.\(\)/);

  const panelsSettings = JSON.parse(read("extension/panels/settings.json"));
  const schemaItem = panelsSettings.schema.find(
    (x) => x.property === "zen.workspace.bgalazka.app_shortcuts",
  );
  assert.ok(schemaItem, "schema must declare zen.workspace.bgalazka.app_shortcuts");
  assert.equal(schemaItem.defaultValue, "{}");
  assert.deepEqual(panelsSettings.settings["zen.workspace.bgalazka.app_shortcuts"], {
    category: "shortcuts",
    section: "App & panel shortcuts",
    owner: "panels",
  });

  const layout = JSON.parse(read("extension/settings/layout.json"));
  const shortcutsCat = layout.categories.find((c) => c.id === "shortcuts");
  assert.ok(
    shortcutsCat.sections.some((s) => s.label === "App & panel shortcuts"),
    "shortcuts category must include App & panel shortcuts section",
  );
  assert.ok(layout.order.includes("zen.workspace.bgalazka.app_shortcuts"));

  const zfsSrc = read("extension/settings/controllers/ZentralFeatureSettings.js");
  assert.match(zfsSrc, /zs-app-shortcuts-card/);
  assert.match(zfsSrc, /openShortcutPrompt/);
  assert.match(zfsSrc, /removeAppShortcut/);
  assert.match(zfsSrc, /_syncAppShortcuts/);
});

console.log(`All ${passed} T3.10 app-shortcuts tests passed.`);
