/*
 * ZENTRAL FILE GUIDE - extension/panels/interaction/ZentralAppShortcuts.js
 *
 * Role: Custom per-app / per-panel keyboard shortcuts (T3.10).
 *   - Reuses the Notes assignable-keys canonical format (Ctrl/Alt/Shift/Meta +
 *     layout-independent e.code/e.key normalization) so shortcuts match across
 *     keyboard layouts and never accept bare single keys or Shift-only typing.
 *   - Refuses collisions with Zen/Firefox shortcuts (live <key> DOM,
 *     gZenKeyboardShortcutsManager, and baseline browser shortcut table) and
 *     with any other Zentral shortcut (other apps, Notes, Insta-Peek, panel
 *     extension keybinds).
 *   - Injects Add / Show / Remove entries into #zen-apps-sidebar-tile-context,
 *     presents an in-window key-recording prompt, toggles visibility of the
 *     bound app from a global capture keydown handler, and exposes its API on
 *     ctx.appShortcuts for Settings UI reuse.
 *
 * Registration: panels/ZentralAppShortcuts
 * Ownership: panels
 */
(function () {
  "use strict";

  window.ZentralModuleLoader.define(
    "panels/ZentralAppShortcuts",
    function ({
      BGALAZKA_EXT_PREFS,
      EXT_KEYBIND_ACTIONS,
      EXT_KEYBIND_DEFAULTS,
      ctx,
      getPref,
      setPref,
      registerCleanup,
    }) {
      const APP_SHORTCUTS_PREF =
        BGALAZKA_EXT_PREFS?.APP_SHORTCUTS ||
        "zen.workspace.bgalazka.app_shortcuts";
      const NOTES_SHORTCUT_PREF = "zen.workspace.zentral.notes.shortcut";
      const NOTES_SHORTCUTS_MAP_PREF = "zen.workspace.zentral.notes.shortcuts";
      const NOTES_ENABLED_PREF = "zen.workspace.zentral.notes.enabled";
      const INSTA_PEEK_PREF = "zen.workspace.apps.insta_peek.shortcut";
      const SIDEBAR_APPS_PREF = "zen.workspace.apps.sidebar.apps";
      const SIDEBAR_ENABLED_PREF = "zen.workspace.apps.sidebar.enabled";
      const PROMPT_ID = "zentral-app-shortcut-prompt";
      const CTX_ASSIGN_ID = "zen-apps-sidebar-app-shortcut-item";
      const CTX_REMOVE_ID = "zen-apps-sidebar-app-shortcut-remove-item";
      const CHANGED_EVENT = "zentral-app-shortcuts-changed";

      const isMacPlatform = () => {
        try {
          return /Mac|iPhone|iPad|iPod/i.test(
            String(navigator.platform || navigator.userAgent || ""),
          );
        } catch (_) {
          return false;
        }
      };

      // ======================================================================
      // Canonical shortcut parsing, formatting & matching
      // (Reuses Notes' assignable-keys contract: Ctrl/Alt/Shift/Meta order,
      // layout-independent e.code for KeyA-Z / Digit0-9, >= 2 keys with a
      // non-Shift modifier.)
      // ======================================================================
      const MODIFIER_KEYS = new Set([
        "Control",
        "Shift",
        "Alt",
        "Meta",
        "OS",
        "AltGraph",
        "CapsLock",
        "NumLock",
        "ScrollLock",
        "Dead",
        "Unidentified",
        "Process",
      ]);

      const KEY_ALIASES = Object.freeze({
        " ": "Space",
        space: "Space",
        spacebar: "Space",
        esc: "Escape",
        escape: "Escape",
        return: "Enter",
        enter: "Enter",
        tab: "Tab",
        bs: "Backspace",
        back: "Backspace",
        backspace: "Backspace",
        del: "Delete",
        delete: "Delete",
        ins: "Insert",
        insert: "Insert",
        home: "Home",
        end: "End",
        pageup: "PageUp",
        pgup: "PageUp",
        pagedown: "PageDown",
        pgdn: "PageDown",
        up: "ArrowUp",
        arrowup: "ArrowUp",
        down: "ArrowDown",
        arrowdown: "ArrowDown",
        left: "ArrowLeft",
        arrowleft: "ArrowLeft",
        right: "ArrowRight",
        arrowright: "ArrowRight",
        "+": "Plus",
        plus: "Plus",
        add: "Plus",
        "-": "Minus",
        minus: "Minus",
        subtract: "Minus",
        "=": "Equal",
        equal: "Equal",
        equals: "Equal",
        ",": "Comma",
        comma: "Comma",
        ".": "Period",
        period: "Period",
        "/": "Slash",
        slash: "Slash",
        "\\": "Backslash",
        backslash: "Backslash",
        "[": "BracketLeft",
        bracketleft: "BracketLeft",
        "]": "BracketRight",
        bracketright: "BracketRight",
        ";": "Semicolon",
        semicolon: "Semicolon",
        "'": "Quote",
        quote: "Quote",
        "`": "Backquote",
        backquote: "Backquote",
      });

      const CODE_TO_KEY = Object.freeze({
        Space: "Space",
        Minus: "Minus",
        Equal: "Equal",
        BracketLeft: "BracketLeft",
        BracketRight: "BracketRight",
        Backslash: "Backslash",
        Semicolon: "Semicolon",
        Quote: "Quote",
        Backquote: "Backquote",
        Comma: "Comma",
        Period: "Period",
        Slash: "Slash",
        NumpadAdd: "Plus",
        NumpadSubtract: "Minus",
      });

      const VK_KEYCODE_MAP = Object.freeze({
        VK_RETURN: "Enter",
        VK_ENTER: "Enter",
        VK_TAB: "Tab",
        VK_ESCAPE: "Escape",
        VK_SPACE: "Space",
        VK_BACK: "Backspace",
        VK_DELETE: "Delete",
        VK_INSERT: "Insert",
        VK_HOME: "Home",
        VK_END: "End",
        VK_PAGE_UP: "PageUp",
        VK_PAGE_DOWN: "PageDown",
        VK_UP: "ArrowUp",
        VK_DOWN: "ArrowDown",
        VK_LEFT: "ArrowLeft",
        VK_RIGHT: "ArrowRight",
        VK_ADD: "Plus",
        VK_PLUS: "Plus",
        VK_SUBTRACT: "Minus",
        VK_MINUS: "Minus",
        VK_EQUALS: "Equal",
        VK_COMMA: "Comma",
        VK_PERIOD: "Period",
        VK_SLASH: "Slash",
        VK_BACK_SLASH: "Backslash",
        VK_OPEN_BRACKET: "BracketLeft",
        VK_CLOSE_BRACKET: "BracketRight",
        VK_SEMICOLON: "Semicolon",
        VK_QUOTE: "Quote",
        VK_BACK_QUOTE: "Backquote",
      });

      function normalizeKeyName(rawKey, code = "") {
        const c = String(code || "");
        if (/^Key([A-Z])$/.test(c)) return c.slice(3);
        if (/^Digit([0-9])$/.test(c)) return c.slice(5);
        if (Object.prototype.hasOwnProperty.call(CODE_TO_KEY, c))
          return CODE_TO_KEY[c];

        const k = String(rawKey || "");
        if (!k || MODIFIER_KEYS.has(k)) return "";
        if (/^[a-zA-Z]$/.test(k)) return k.toUpperCase();
        if (/^[0-9]$/.test(k)) return k;
        if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(k)) return k.toUpperCase();
        const lower = k.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(KEY_ALIASES, lower))
          return KEY_ALIASES[lower];
        return "";
      }

      function normalizeKeycode(vk) {
        const upper = String(vk || "").trim().toUpperCase();
        if (!upper) return "";
        if (/^VK_F([1-9]|1[0-9]|2[0-4])$/.test(upper)) return upper.slice(3);
        if (/^VK_([A-Z0-9])$/.test(upper)) return upper.slice(3);
        return VK_KEYCODE_MAP[upper] || "";
      }

      function formatCombo(spec) {
        if (!spec || !spec.key) return "";
        const parts = [];
        if (spec.ctrl) parts.push("Ctrl");
        if (spec.alt) parts.push("Alt");
        if (spec.shift) parts.push("Shift");
        if (spec.meta) parts.push("Meta");
        parts.push(spec.key);
        return parts.join("+");
      }

      function parseShortcut(text, isMac = isMacPlatform()) {
        if (!text || typeof text !== "string") return null;
        const spec = {
          ctrl: false,
          alt: false,
          shift: false,
          meta: false,
          key: "",
        };
        const tokens = text
          .split("+")
          .map((t) => t.trim())
          .filter(Boolean);
        if (!tokens.length) return null;
        for (const token of tokens) {
          const lower = token.toLowerCase();
          if (lower === "ctrl" || lower === "control") spec.ctrl = true;
          else if (lower === "alt" || lower === "option" || lower === "opt")
            spec.alt = true;
          else if (lower === "shift") spec.shift = true;
          else if (
            lower === "meta" ||
            lower === "cmd" ||
            lower === "command" ||
            lower === "super" ||
            lower === "os"
          )
            spec.meta = true;
          else if (lower === "accel" || lower === "mod" || lower === "primary") {
            if (isMac) spec.meta = true;
            else spec.ctrl = true;
          } else {
            const normalized = normalizeKeyName(token);
            if (!normalized || spec.key) return null;
            spec.key = normalized;
          }
        }
        if (!spec.key) return null;
        const canonical = formatCombo(spec);
        const modCount =
          (spec.ctrl ? 1 : 0) +
          (spec.alt ? 1 : 0) +
          (spec.shift ? 1 : 0) +
          (spec.meta ? 1 : 0);
        return {
          ...spec,
          canonical,
          count: modCount + 1,
        };
      }

      function normalizeCombo(text, isMac = isMacPlatform()) {
        return parseShortcut(text, isMac)?.canonical || "";
      }

      function validateAppShortcut(text, isMac = isMacPlatform()) {
        const parsed = parseShortcut(text, isMac);
        if (!parsed) {
          return {
            valid: false,
            combo: "",
            reason:
              "Shortcut must combine at least 2 keys (include Ctrl, Alt, or Cmd).",
          };
        }
        if (parsed.count < 2) {
          return {
            valid: false,
            combo: "",
            reason:
              "Shortcut must combine at least 2 keys (no single-key shortcuts).",
          };
        }
        if (!parsed.ctrl && !parsed.alt && !parsed.meta) {
          return {
            valid: false,
            combo: "",
            reason:
              "Include Ctrl, Alt, or Cmd — Shift alone would interfere with typing.",
          };
        }
        return { valid: true, combo: parsed.canonical, parsed, reason: "" };
      }

      function comboFromEvent(e, isMac = isMacPlatform()) {
        if (!e) {
          return {
            combo: "",
            isModifierOnly: false,
            heldModifiers: [],
            error: "No key event.",
          };
        }
        const heldModifiers = [];
        if (e.ctrlKey) heldModifiers.push("Ctrl");
        if (e.altKey) heldModifiers.push("Alt");
        if (e.shiftKey) heldModifiers.push("Shift");
        if (e.metaKey) heldModifiers.push("Meta");

        const rawKey = String(e.key || "");
        if (MODIFIER_KEYS.has(rawKey)) {
          return {
            combo: "",
            isModifierOnly: true,
            heldModifiers,
            error: null,
          };
        }

        const key = normalizeKeyName(rawKey, e.code);
        if (!key) {
          return {
            combo: "",
            isModifierOnly: false,
            heldModifiers,
            error: "Unsupported key. Try a letter, number, arrow, or function key.",
          };
        }

        const canonical = formatCombo({
          ctrl: !!e.ctrlKey,
          alt: !!e.altKey,
          shift: !!e.shiftKey,
          meta: !!e.metaKey,
          key,
        });
        const check = validateAppShortcut(canonical, isMac);
        if (!check.valid) {
          return {
            combo: "",
            isModifierOnly: false,
            heldModifiers,
            error: check.reason,
          };
        }
        return {
          combo: check.combo,
          isModifierOnly: false,
          heldModifiers,
          error: null,
        };
      }

      function matchesShortcut(e, comboOrSpec, isMac = isMacPlatform()) {
        if (!e) return false;
        const spec =
          typeof comboOrSpec === "string"
            ? parseShortcut(comboOrSpec, isMac)
            : comboOrSpec;
        if (!spec || !spec.key) return false;
        if (!!e.ctrlKey !== !!spec.ctrl) return false;
        if (!!e.altKey !== !!spec.alt) return false;
        if (!!e.shiftKey !== !!spec.shift) return false;
        if (!!e.metaKey !== !!spec.meta) return false;
        const eventKey = normalizeKeyName(e.key, e.code);
        return eventKey === spec.key;
      }

      // ======================================================================
      // Built-in baseline Zen & Firefox browser shortcuts
      // (Supplements live <key> DOM elements and gZenKeyboardShortcutsManager.)
      // ======================================================================
      const BASELINE_BROWSER_SHORTCUTS = Object.freeze([
        // Standard Firefox / Zen primary shortcuts (Accel = Ctrl on Win/Linux, Meta on macOS)
        ["Accel+A", "Select All"],
        ["Accel+B", "Bookmarks Sidebar"],
        ["Accel+C", "Copy"],
        ["Accel+D", "Bookmark This Page"],
        ["Accel+E", "Search Bar"],
        ["Accel+F", "Find in Page"],
        ["Accel+G", "Find Again"],
        ["Accel+H", "History"],
        ["Accel+I", "Page Info"],
        ["Accel+J", "Downloads"],
        ["Accel+K", "Focus Search"],
        ["Accel+L", "Focus Address Bar"],
        ["Accel+M", "Mute Tab"],
        ["Accel+N", "New Window"],
        ["Accel+O", "Open File"],
        ["Accel+P", "Print"],
        ["Accel+Q", "Quit Browser"],
        ["Accel+R", "Reload"],
        ["Accel+S", "Save Page"],
        ["Accel+T", "New Tab"],
        ["Accel+U", "View Page Source"],
        ["Accel+V", "Paste"],
        ["Accel+W", "Close Tab"],
        ["Accel+X", "Cut"],
        ["Accel+Y", "Redo"],
        ["Accel+Z", "Undo"],
        ["Accel+0", "Reset Zoom"],
        ["Accel+1", "Switch Tab 1"],
        ["Accel+2", "Switch Tab 2"],
        ["Accel+3", "Switch Tab 3"],
        ["Accel+4", "Switch Tab 4"],
        ["Accel+5", "Switch Tab 5"],
        ["Accel+6", "Switch Tab 6"],
        ["Accel+7", "Switch Tab 7"],
        ["Accel+8", "Switch Tab 8"],
        ["Accel+9", "Switch to Last Tab"],
        ["Accel+Plus", "Zoom In"],
        ["Accel+Equal", "Zoom In"],
        ["Accel+Minus", "Zoom Out"],
        ["Accel+Tab", "Next Tab"],
        ["Accel+PageUp", "Previous Tab"],
        ["Accel+PageDown", "Next Tab"],
        ["Accel+F4", "Close Tab"],
        ["Accel+F5", "Hard Reload"],
        ["Accel+Shift+A", "Add-ons Manager"],
        ["Accel+Shift+B", "Toggle Bookmarks Toolbar"],
        ["Accel+Shift+C", "Inspector"],
        ["Accel+Shift+D", "Bookmark All Tabs"],
        ["Accel+Shift+E", "Network Monitor"],
        ["Accel+Shift+F", "Global Find"],
        ["Accel+Shift+G", "Find Previous"],
        ["Accel+Shift+H", "Library History"],
        ["Accel+Shift+I", "Web Developer Tools"],
        ["Accel+Shift+J", "Browser Console"],
        ["Accel+Shift+K", "Web Console"],
        ["Accel+Shift+M", "Responsive Design Mode"],
        ["Accel+Shift+N", "Reopen Closed Window"],
        ["Accel+Shift+O", "Manage Bookmarks"],
        ["Accel+Shift+P", "New Private Window"],
        ["Accel+Shift+Q", "Quit Browser"],
        ["Accel+Shift+R", "Hard Reload"],
        ["Accel+Shift+S", "Take Screenshot"],
        ["Accel+Shift+T", "Reopen Closed Tab"],
        ["Accel+Shift+V", "Paste Without Formatting"],
        ["Accel+Shift+W", "Close Window"],
        ["Accel+Shift+Y", "Downloads"],
        ["Accel+Shift+Z", "Redo"],
        ["Accel+Shift+Tab", "Previous Tab"],
        ["Accel+Shift+Delete", "Clear Recent History"],
        // Common Alt browser shortcuts
        ["Alt+ArrowLeft", "Back"],
        ["Alt+ArrowRight", "Forward"],
        ["Alt+Home", "Home Page"],
        ["Alt+D", "Focus Address Bar"],
        ["Alt+F4", "Close Window"],
        ["Alt+Tab", "Window Switcher"],
        // Zen Browser defaults (Compact Mode, Copy URL, Split View)
        ["Accel+Alt+C", "Zen Copy Current URL"],
        ["Accel+Alt+S", "Zen Compact Mode"],
        ["Accel+Alt+G", "Zen Split View Grid"],
        ["Accel+Alt+H", "Zen Split View Horizontal"],
        ["Accel+Alt+V", "Zen Split View Vertical"],
        ["Accel+Alt+U", "Zen Unsplit View"],
        ["Accel+Alt+E", "Zen Glance / Split Action"],
      ]);

      const PANEL_ACTION_LABELS = Object.freeze({
        CLOSE_PANEL: "Close Panel",
        BACK: "Panel Back",
        FORWARD: "Panel Forward",
        RELOAD: "Reload Panel",
        FOCUS_URL: "Focus Panel URL Bar",
        TOGGLE_PIN: "Toggle Pin",
        TOGGLE_EXPAND: "Expand / Restore Panel",
        TOGGLE_DUAL_VIEW: "Toggle Dual View",
        TOGGLE_RESIZE: "Toggle Panel Resize",
        TOGGLE_TOOLBAR: "Toggle Panel Toolbar",
        TOGGLE_TRANSLUCENCY: "Toggle Panel Translucency",
        TOGGLE_OPPOSITE_DOCKING: "Toggle Opposite Docking",
        TOGGLE_EDGE_ATTACHED: "Toggle Edge-Attached Panel",
        TOGGLE_INPUT_SHIELD: "Toggle Panel Input Shield",
        ZOOM_IN: "Panel Zoom In",
        ZOOM_OUT: "Panel Zoom Out",
        ZOOM_RESET: "Panel Zoom Reset",
        OPEN_SETTINGS: "Open Zentral Settings",
      });

      const NOTES_GLOBAL_ACTION_LABELS = Object.freeze({
        quickNew: "Zentral Notes (New note)",
        openFloating: "Zentral Notes (Toggle)",
        captureQuick: "Zentral Notes (Capture selection)",
        captureInbox: "Zentral Notes (Capture to Inbox)",
        capturePage: "Zentral Notes (Capture page)",
      });

      // ======================================================================
      // Persistence & app catalog helpers
      // ======================================================================
      function readAppShortcuts(isMac = isMacPlatform()) {
        const out = {};
        try {
          const raw = JSON.parse(getPref(APP_SHORTCUTS_PREF, "{}") || "{}");
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
          const used = new Set();
          for (const [appId, combo] of Object.entries(raw)) {
            if (typeof appId !== "string" || !appId.trim()) continue;
            const check = validateAppShortcut(String(combo || ""), isMac);
            if (!check.valid || used.has(check.combo)) continue;
            used.add(check.combo);
            out[appId] = check.combo;
          }
        } catch (_) {}
        return out;
      }

      function writeAppShortcuts(map) {
        const clean = {};
        for (const [appId, combo] of Object.entries(map || {})) {
          if (typeof appId === "string" && appId.trim() && combo) {
            clean[appId] = String(combo);
          }
        }
        setPref(APP_SHORTCUTS_PREF, JSON.stringify(clean));
        try {
          window.dispatchEvent(
            new CustomEvent(CHANGED_EVENT, {
              detail: { shortcuts: { ...clean } },
            }),
          );
        } catch (_) {}
        return clean;
      }

      function readSidebarApps() {
        try {
          const saved = JSON.parse(getPref(SIDEBAR_APPS_PREF, "[]") || "[]");
          return Array.isArray(saved) ? saved : [];
        } catch (_) {
          return [];
        }
      }

      function appDisplayName(app, fallbackId = "") {
        if (app?.name && String(app.name).trim()) return String(app.name).trim();
        if (app?.title && String(app.title).trim())
          return String(app.title).trim();
        if (app?.url) {
          try {
            const host = new URL(app.url).hostname.replace(/^www\./, "");
            if (host) return host;
          } catch (_) {}
          return String(app.url);
        }
        return String(app?.id || fallbackId || "App");
      }

      function resolveApp(appId) {
        if (!appId) return null;
        const essential = ctx.essentialPanels?.get?.(appId);
        if (essential?.tab?.isConnected && essential.app) return essential.app;
        const normal = readSidebarApps().find((a) => a && a.id === appId);
        if (normal) return normal;
        const snapshot = ctx.linkedPairFor?.(appId)?.apps?.[appId];
        if (snapshot?.url) return { ...snapshot, id: appId, workspaceId: "all" };
        return null;
      }

      function listKnownApps() {
        const byId = new Map();
        for (const app of readSidebarApps()) {
          if (!app?.id) continue;
          byId.set(app.id, {
            id: app.id,
            title: appDisplayName(app, app.id),
            url: app.url || "",
            kind: "sidebar",
            app,
          });
        }
        if (ctx.essentialPanels && typeof ctx.essentialPanels.forEach === "function") {
          ctx.essentialPanels.forEach((entry, id) => {
            if (!id || byId.has(id)) return;
            if (entry?.tab && entry.tab.isConnected === false) return;
            const app = entry?.app || { id };
            byId.set(id, {
              id,
              title: appDisplayName(app, id),
              url: app.url || "",
              kind: "essential",
              app,
            });
          });
        }
        const savedShortcuts = readAppShortcuts();
        for (const appId of Object.keys(savedShortcuts)) {
          if (byId.has(appId)) continue;
          const snapshot = ctx.linkedPairFor?.(appId)?.apps?.[appId];
          byId.set(appId, {
            id: appId,
            title: appDisplayName(snapshot, appId),
            url: snapshot?.url || "",
            kind: snapshot ? "essential" : "saved",
            unavailable: !snapshot,
            app: snapshot ? { ...snapshot, id: appId, workspaceId: "all" } : null,
          });
        }
        return [...byId.values()].map((entry) => ({
          ...entry,
          shortcut: savedShortcuts[entry.id] || "",
        }));
      }

      // ======================================================================
      // Comprehensive Collision Detection
      // ======================================================================
      function parseKeyElementModifiers(rawMods, isMac) {
        const spec = { ctrl: false, alt: false, shift: false, meta: false };
        for (const part of String(rawMods || "")
          .split(/[\s,]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)) {
          if (part === "accel") {
            if (isMac) spec.meta = true;
            else spec.ctrl = true;
          } else if (part === "control" || part === "ctrl") spec.ctrl = true;
          else if (part === "alt" || part === "access") spec.alt = true;
          else if (part === "shift") spec.shift = true;
          else if (part === "meta" || part === "os") spec.meta = true;
        }
        return spec;
      }

      function collectDomKeyShortcuts(isMac) {
        const map = new Map();
        if (typeof document?.querySelectorAll !== "function") return map;
        let nodes = [];
        try {
          nodes = document.querySelectorAll("key");
        } catch (_) {
          return map;
        }
        for (const el of nodes) {
          if (!el || typeof el.getAttribute !== "function") continue;
          if (el.getAttribute("disabled") === "true") continue;
          const modsRaw = el.getAttribute("modifiers") || "";
          const keyAttr = el.getAttribute("key") || "";
          const keycodeAttr = el.getAttribute("keycode") || "";
          const key = keyAttr
            ? normalizeKeyName(keyAttr)
            : normalizeKeycode(keycodeAttr);
          if (!key) continue;
          const mods = parseKeyElementModifiers(modsRaw, isMac);
          const combo = formatCombo({ ...mods, key });
          if (!validateAppShortcut(combo, isMac).valid) continue;
          if (!map.has(combo)) {
            const id =
              el.getAttribute("id") || el.getAttribute("command") || "browser";
            map.set(combo, {
              source: "browser",
              combo,
              label: `Zen / Firefox shortcut (${id})`,
            });
          }
        }
        return map;
      }

      function collectZenManagerShortcuts(isMac) {
        const map = new Map();
        const mgr = window.gZenKeyboardShortcutsManager;
        const list = mgr?._currentShortcutList;
        if (!Array.isArray(list)) return map;
        for (const entry of list) {
          if (!entry || entry.disabled || entry.isEmpty?.()) continue;
          const key = entry.key
            ? normalizeKeyName(entry.key)
            : normalizeKeycode(entry.keycode);
          if (!key) continue;
          const modsObj = entry.modifiers || {};
          const ctrl = Boolean(
            modsObj.control || modsObj.ctrl || (!isMac && modsObj.accel),
          );
          const meta = Boolean(
            modsObj.meta || (isMac && modsObj.accel),
          );
          const alt = Boolean(modsObj.alt);
          const shift = Boolean(modsObj.shift);
          const combo = formatCombo({ ctrl, alt, shift, meta, key });
          if (!validateAppShortcut(combo, isMac).valid) continue;
          if (!map.has(combo)) {
            const id = entry.id || entry.action || "Zen";
            map.set(combo, {
              source: "browser",
              combo,
              label: `Zen shortcut (${id})`,
            });
          }
        }
        return map;
      }

      function collectReservedShortcuts({
        excludeAppId = null,
        isMac = isMacPlatform(),
      } = {}) {
        const reserved = new Map();
        const add = (combo, entry) => {
          const norm = normalizeCombo(combo, isMac);
          if (!norm || reserved.has(norm)) return;
          reserved.set(norm, { ...entry, combo: norm });
        };

        // 1. Other custom per-app shortcuts
        const appShortcuts = readAppShortcuts(isMac);
        const appTitles = new Map();
        for (const app of readSidebarApps()) {
          if (app?.id) appTitles.set(app.id, appDisplayName(app, app.id));
        }
        for (const [appId, combo] of Object.entries(appShortcuts)) {
          if (excludeAppId && appId === excludeAppId) continue;
          const title =
            appTitles.get(appId) ||
            appDisplayName(resolveApp(appId), appId);
          add(combo, {
            source: "app",
            appId,
            label: `Zentral app "${title}"`,
          });
        }

        // 2. Zentral Notes global toggle & global action shortcuts
        if (getPref(NOTES_ENABLED_PREF, true) !== false) {
          const notesToggle = getPref(NOTES_SHORTCUT_PREF, "Alt+Shift+N");
          if (notesToggle && String(notesToggle).toLowerCase() !== "none") {
            add(notesToggle, {
              source: "zentral",
              label: "Zentral Notes shortcut",
            });
          }
          try {
            const notesMap = JSON.parse(
              getPref(NOTES_SHORTCUTS_MAP_PREF, "") || "{}",
            );
            if (notesMap && typeof notesMap === "object") {
              for (const [actionId, combo] of Object.entries(notesMap)) {
                if (!combo || typeof combo !== "string") continue;
                const label =
                  NOTES_GLOBAL_ACTION_LABELS[actionId] ||
                  `Zentral Notes shortcut (${actionId})`;
                add(combo, { source: "zentral", label });
              }
            }
          } catch (_) {}
        }

        // 3. Zentral Insta-Peek shortcut
        const instaPeek = getPref(INSTA_PEEK_PREF, "Alt+Q");
        if (instaPeek && String(instaPeek).trim().toLowerCase() !== "none") {
          add(instaPeek, {
            source: "zentral",
            label: "Zentral Insta-Peek shortcut",
          });
        }

        // 4. Zentral Extension Panel keybinds
        if (Array.isArray(EXT_KEYBIND_ACTIONS)) {
          for (const action of EXT_KEYBIND_ACTIONS) {
            const def = EXT_KEYBIND_DEFAULTS?.[action.key] || "";
            const configured = getPref(action.pref, def);
            if (!configured || !String(configured).trim()) continue;
            const label = PANEL_ACTION_LABELS[action.key] || action.key;
            add(configured, {
              source: "zentral",
              label: `Zentral shortcut "${label}"`,
            });
          }
        }

        // 5. Live Zen Keyboard Shortcuts Manager
        for (const [combo, entry] of collectZenManagerShortcuts(isMac)) {
          add(combo, entry);
        }

        // 6. Live Firefox / Zen DOM <key> elements
        for (const [combo, entry] of collectDomKeyShortcuts(isMac)) {
          add(combo, entry);
        }

        // 7. Built-in baseline Zen / Firefox shortcuts
        for (const [rawCombo, desc] of BASELINE_BROWSER_SHORTCUTS) {
          add(rawCombo, {
            source: "browser",
            label: `Firefox / Zen shortcut (${desc})`,
          });
        }

        return reserved;
      }

      function findShortcutConflict(
        combo,
        { excludeAppId = null, isMac = isMacPlatform() } = {},
      ) {
        const norm = normalizeCombo(combo, isMac);
        if (!norm) return null;
        const reserved = collectReservedShortcuts({ excludeAppId, isMac });
        return reserved.get(norm) || null;
      }

      function getAppShortcut(appId) {
        if (!appId) return "";
        return readAppShortcuts()[appId] || "";
      }

      function setAppShortcut(appId, rawCombo, { isMac = isMacPlatform() } = {}) {
        if (!appId || typeof appId !== "string") {
          return { ok: false, reason: "No app selected." };
        }
        const check = validateAppShortcut(rawCombo, isMac);
        if (!check.valid) {
          return { ok: false, reason: check.reason };
        }
        const conflict = findShortcutConflict(check.combo, {
          excludeAppId: appId,
          isMac,
        });
        if (conflict) {
          return {
            ok: false,
            reason: `Already used by ${conflict.label}. Choose a different combination.`,
            conflict,
          };
        }
        const map = readAppShortcuts(isMac);
        map[appId] = check.combo;
        writeAppShortcuts(map);
        return { ok: true, combo: check.combo };
      }

      function removeAppShortcut(appId) {
        if (!appId) return false;
        const map = readAppShortcuts();
        if (!Object.prototype.hasOwnProperty.call(map, appId)) return false;
        delete map[appId];
        writeAppShortcuts(map);
        return true;
      }

      // ======================================================================
      // Visibility check & reveal/hide toggle
      // ======================================================================
      function isAppVisible(appId) {
        if (!appId) return false;
        const hoverHidden = document.documentElement?.hasAttribute?.(
          "bgalazka-hover-panel-hidden",
        );
        if (hoverHidden) return false;

        const apps = window.Zentral?.Apps;
        const snap =
          typeof apps?.getPanelSnapshot === "function"
            ? apps.getPanelSnapshot()
            : null;
        const root =
          snap?.root || document.getElementById("zen-app-panel-root");
        const primaryOpen = !!(
          root &&
          root.hasAttribute("open") &&
          !root.hasAttribute("closing")
        );
        const activeId =
          snap?.appId || ctx.getActiveAppBrowser?.()?._bgalazkaAppId || null;
        if (primaryOpen && activeId === appId) return true;

        const second =
          typeof ctx.secondarySnapshot === "function"
            ? ctx.secondarySnapshot()
            : null;
        if (
          primaryOpen &&
          second?.browser &&
          second.browser._bgalazkaAppId === appId &&
          second.browser.isConnected !== false &&
          second.browser.style?.display !== "none"
        ) {
          return true;
        }
        return false;
      }

      function toggleAppById(appId) {
        if (!appId) return { action: "noop", appId: "" };
        if (getPref(SIDEBAR_ENABLED_PREF, true) === false) {
          return { action: "disabled", appId };
        }
        const apps = window.Zentral?.Apps;
        if (!apps) return { action: "unavailable", appId };

        if (isAppVisible(appId)) {
          if (typeof apps.closePanel === "function") {
            apps.closePanel();
            return { action: "hidden", appId };
          }
          return { action: "unavailable", appId };
        }

        const app = resolveApp(appId);
        if (!app) return { action: "missing", appId };

        const snap =
          typeof apps.getPanelSnapshot === "function"
            ? apps.getPanelSnapshot()
            : null;
        const root =
          snap?.root || document.getElementById("zen-app-panel-root");
        const primaryOpen = !!(
          root &&
          root.hasAttribute("open") &&
          !root.hasAttribute("closing")
        );
        const hoverHidden = document.documentElement?.hasAttribute?.(
          "bgalazka-hover-panel-hidden",
        );
        const activeId =
          snap?.appId || ctx.getActiveAppBrowser?.()?._bgalazkaAppId || null;

        if (
          primaryOpen &&
          hoverHidden &&
          activeId === appId &&
          typeof ctx.setHoverPanelHidden === "function"
        ) {
          ctx.setHoverPanelHidden(false);
          return { action: "shown", appId };
        }

        if (hoverHidden && typeof ctx.setHoverPanelHidden === "function") {
          ctx.setHoverPanelHidden(false);
        }
        if (typeof apps.openPanel === "function") {
          apps.openPanel(app);
          return { action: "shown", appId };
        }
        return { action: "unavailable", appId };
      }

      // ======================================================================
      // In-window shortcut recorder prompt
      // ======================================================================
      let activePromptCleanup = null;

      function createHtml(tag) {
        return typeof document.createElementNS === "function"
          ? document.createElementNS("http://www.w3.org/1999/xhtml", tag)
          : document.createElement(tag);
      }

      function isPromptOpen() {
        return Boolean(activePromptCleanup || document.getElementById(PROMPT_ID));
      }

      function closeShortcutPrompt() {
        if (activePromptCleanup) {
          const fn = activePromptCleanup;
          activePromptCleanup = null;
          try {
            fn();
          } catch (_) {}
        }
        document.getElementById(PROMPT_ID)?.remove();
      }

      function openShortcutPrompt(appId, explicitLabel = "") {
        if (!appId) return null;
        closeShortcutPrompt();

        const app = resolveApp(appId);
        const appLabel = explicitLabel || appDisplayName(app, appId);
        const existingCombo = getAppShortcut(appId);
        let stagedCombo = "";

        const backdrop = createHtml("div");
        backdrop.id = PROMPT_ID;
        backdrop.className = "zas-backdrop";
        backdrop.setAttribute("role", "dialog");
        backdrop.setAttribute("aria-modal", "true");
        backdrop.dataset.appId = appId;

        const dialog = createHtml("div");
        dialog.className = "zas-dialog";

        const title = createHtml("h3");
        title.className = "zas-title";
        title.textContent = existingCombo
          ? `Change shortcut for ${appLabel}`
          : `Add custom keyboard shortcut`;

        const subtitle = createHtml("p");
        subtitle.className = "zas-subtitle";
        subtitle.textContent =
          `Press at least 2 keys (including Ctrl, Alt, or Cmd) to toggle "${appLabel}". ` +
          `Press Escape to cancel.`;

        const captureBox = createHtml("div");
        captureBox.className = "zas-capture-box";
        captureBox.tabIndex = 0;
        captureBox.dataset.state = existingCombo ? "existing" : "idle";
        captureBox.textContent = existingCombo
          ? `Current: ${existingCombo} — press new keys…`
          : "Waiting for key combination…";

        const status = createHtml("div");
        status.className = "zas-status";
        status.dataset.tone = "neutral";
        status.textContent = existingCombo
          ? `Currently assigned to ${existingCombo}.`
          : "Example: Alt+Shift+I or Ctrl+Alt+1";

        const actions = createHtml("div");
        actions.className = "zas-actions";

        let removeBtn = null;
        if (existingCombo) {
          removeBtn = createHtml("button");
          removeBtn.type = "button";
          removeBtn.className = "zas-btn zas-btn-remove";
          removeBtn.textContent = "Remove shortcut";
          removeBtn.addEventListener("click", () => {
            removeAppShortcut(appId);
            closeShortcutPrompt();
          });
          actions.appendChild(removeBtn);
        }

        const spacer = createHtml("div");
        spacer.className = "zas-spacer";
        actions.appendChild(spacer);

        const cancelBtn = createHtml("button");
        cancelBtn.type = "button";
        cancelBtn.className = "zas-btn zas-btn-cancel";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => closeShortcutPrompt());

        const saveBtn = createHtml("button");
        saveBtn.type = "button";
        saveBtn.className = "zas-btn zas-btn-save";
        saveBtn.textContent = "Save";
        saveBtn.disabled = true;

        const commitSave = () => {
          if (!stagedCombo) return;
          const result = setAppShortcut(appId, stagedCombo);
          if (!result.ok) {
            stagedCombo = "";
            saveBtn.disabled = true;
            captureBox.dataset.state = "error";
            status.dataset.tone = "error";
            status.textContent = result.reason;
            return;
          }
          closeShortcutPrompt();
        };
        saveBtn.addEventListener("click", commitSave);

        actions.append(cancelBtn, saveBtn);
        dialog.append(title, subtitle, captureBox, status, actions);
        backdrop.appendChild(dialog);

        const onBackdropClick = (e) => {
          if (e.target === backdrop) closeShortcutPrompt();
        };
        backdrop.addEventListener("click", onBackdropClick);

        const onPromptKeyDown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function")
            e.stopImmediatePropagation();

          // Bare Escape cancels cleanly; bare Enter confirms a valid staged shortcut.
          if (
            !e.ctrlKey &&
            !e.altKey &&
            !e.shiftKey &&
            !e.metaKey &&
            e.key === "Escape"
          ) {
            closeShortcutPrompt();
            return;
          }
          if (
            !e.ctrlKey &&
            !e.altKey &&
            !e.shiftKey &&
            !e.metaKey &&
            e.key === "Enter" &&
            stagedCombo &&
            !saveBtn.disabled
          ) {
            commitSave();
            return;
          }

          const captured = comboFromEvent(e);
          if (captured.isModifierOnly) {
            captureBox.dataset.state = "recording";
            captureBox.textContent = captured.heldModifiers.length
              ? `${captured.heldModifiers.join(" + ")} + …`
              : "Waiting for key combination…";
            status.dataset.tone = "neutral";
            status.textContent = "Now press a letter, number, arrow, or function key.";
            return;
          }

          if (captured.error || !captured.combo) {
            stagedCombo = "";
            saveBtn.disabled = true;
            captureBox.dataset.state = "error";
            const attemptedKey = normalizeKeyName(e.key, e.code) || e.key || "";
            captureBox.textContent = attemptedKey
              ? `${[...captured.heldModifiers, attemptedKey].join("+")}`
              : "Invalid key combination";
            status.dataset.tone = "error";
            status.textContent =
              captured.error ||
              "Shortcut must combine at least 2 keys (include Ctrl, Alt, or Cmd).";
            return;
          }

          const conflict = findShortcutConflict(captured.combo, {
            excludeAppId: appId,
          });
          if (conflict) {
            stagedCombo = "";
            saveBtn.disabled = true;
            captureBox.dataset.state = "error";
            captureBox.textContent = captured.combo;
            status.dataset.tone = "error";
            status.textContent = `Already used by ${conflict.label}. Try another combination.`;
            return;
          }

          stagedCombo = captured.combo;
          saveBtn.disabled = false;
          captureBox.dataset.state = "valid";
          captureBox.textContent = captured.combo;
          status.dataset.tone = "valid";
          status.textContent = `Ready — click Save or press Enter to bind ${captured.combo}.`;
        };

        window.addEventListener("keydown", onPromptKeyDown, true);
        activePromptCleanup = () => {
          window.removeEventListener("keydown", onPromptKeyDown, true);
          backdrop.removeEventListener("click", onBackdropClick);
          backdrop.remove();
        };

        const host =
          document.getElementById("browser") ||
          document.body ||
          document.documentElement;
        host.appendChild(backdrop);
        try {
          captureBox.focus();
        } catch (_) {}

        return {
          element: backdrop,
          close: closeShortcutPrompt,
        };
      }

      // ======================================================================
      // Context menu integration (#zen-apps-sidebar-tile-context)
      // ======================================================================
      function ensureContextMenuItems(popup) {
        let assignItem = popup.querySelector("#" + CTX_ASSIGN_ID);
        let removeItem = popup.querySelector("#" + CTX_REMOVE_ID);
        if (assignItem && removeItem) return { assignItem, removeItem };

        const createXul = (tag) =>
          typeof document.createXULElement === "function"
            ? document.createXULElement(tag)
            : document.createElement(tag);

        const anchor =
          popup.querySelector("#zen-apps-sidebar-open-startup-menu") ||
          popup.querySelector("#zen-apps-sidebar-preload-item");

        if (!assignItem) {
          assignItem = createXul("menuitem");
          assignItem.id = CTX_ASSIGN_ID;
          assignItem.setAttribute("label", "Add custom keyboard shortcut");
          assignItem.addEventListener("command", () => {
            const id = popup.dataset.activeAppId;
            if (!id) return;
            openShortcutPrompt(id);
          });
          if (anchor && typeof anchor.insertAdjacentElement === "function") {
            anchor.insertAdjacentElement("afterend", assignItem);
          } else {
            popup.appendChild(assignItem);
          }
        }

        if (!removeItem) {
          removeItem = createXul("menuitem");
          removeItem.id = CTX_REMOVE_ID;
          removeItem.setAttribute("label", "Remove custom keyboard shortcut");
          removeItem.hidden = true;
          removeItem.addEventListener("command", () => {
            const id = popup.dataset.activeAppId;
            if (!id) return;
            removeAppShortcut(id);
          });
          if (typeof assignItem.insertAdjacentElement === "function") {
            assignItem.insertAdjacentElement("afterend", removeItem);
          } else {
            popup.appendChild(removeItem);
          }
        }

        return { assignItem, removeItem };
      }

      function onTileContextShowing(event) {
        const popup = event?.target;
        if (!popup || popup.id !== "zen-apps-sidebar-tile-context") return;
        const { assignItem, removeItem } = ensureContextMenuItems(popup);
        const appId = popup.dataset?.activeAppId || "";
        if (!appId) {
          assignItem.hidden = true;
          removeItem.hidden = true;
          return;
        }
        const current = getAppShortcut(appId);
        assignItem.hidden = false;
        if (current) {
          assignItem.setAttribute("label", `Custom shortcut: ${current}`);
          assignItem.setAttribute(
            "tooltiptext",
            "Click to change this app's custom keyboard shortcut",
          );
          removeItem.hidden = false;
          removeItem.setAttribute(
            "label",
            `Remove custom shortcut (${current})`,
          );
        } else {
          assignItem.setAttribute("label", "Add custom keyboard shortcut");
          assignItem.removeAttribute("tooltiptext");
          removeItem.hidden = true;
        }
      }

      // ======================================================================
      // Global keydown listener (works even when no panel is open)
      // ======================================================================
      function onGlobalKeyDown(e) {
        if (!e || e.defaultPrevented || e.repeat || e.isComposing) return;
        if (!(e.ctrlKey || e.altKey || e.metaKey)) return;
        if (isPromptOpen()) return;
        if (document.activeElement?.dataset?.recording === "true") return;
        if (
          document.documentElement?.getAttribute?.("zentral-video-enlarged") ===
            "true" ||
          document.activeElement?.closest?.(
            "#zentral-video-preview[data-enlarged]",
          )
        ) {
          return;
        }
        if (getPref(SIDEBAR_ENABLED_PREF, true) === false) return;

        const shortcuts = readAppShortcuts();
        const entries = Object.entries(shortcuts);
        if (!entries.length) return;

        for (const [appId, combo] of entries) {
          if (matchesShortcut(e, combo)) {
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === "function")
              e.stopImmediatePropagation();
            toggleAppById(appId);
            return;
          }
        }
      }

      window.addEventListener("popupshowing", onTileContextShowing);
      window.addEventListener("keydown", onGlobalKeyDown, true);

      registerCleanup(() => {
        closeShortcutPrompt();
        window.removeEventListener("popupshowing", onTileContextShowing);
        window.removeEventListener("keydown", onGlobalKeyDown, true);
        document.getElementById(CTX_ASSIGN_ID)?.remove();
        document.getElementById(CTX_REMOVE_ID)?.remove();
        if (ctx.appShortcuts === api) delete ctx.appShortcuts;
      });

      const api = {
        PREF: APP_SHORTCUTS_PREF,
        CHANGED_EVENT,
        PROMPT_ID,
        CTX_ASSIGN_ID,
        CTX_REMOVE_ID,
        normalizeKeyName,
        normalizeKeycode,
        formatCombo,
        parseShortcut,
        normalizeCombo,
        validateAppShortcut,
        comboFromEvent,
        matchesShortcut,
        collectReservedShortcuts,
        findShortcutConflict,
        readAppShortcuts,
        writeAppShortcuts,
        getAppShortcut,
        setAppShortcut,
        removeAppShortcut,
        listKnownApps,
        resolveApp,
        isAppVisible,
        toggleAppById,
        openShortcutPrompt,
        closeShortcutPrompt,
        isPromptOpen,
      };
      ctx.appShortcuts = api;
      return api;
    },
  );
})();
