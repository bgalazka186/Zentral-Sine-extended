/* Boost-owned card implementation. This source is loaded by both the full-pack
 * feature loader and the standalone Boost loader. It contains no Widgets API,
 * tray registration or second card implementation. The loader supplies a small
 * adapter for the document/window, sidebar geometry, host-unload hook, timers
 * and listeners; Boost supplies its existing public API and pref gate.
 *
 * Every DOM node, listener, observer, one-shot timer, onChange subscription and
 * startSampling() call is released by the returned cleanup. There is no
 * setInterval or permanent polling.
 */
(function installBoostWidgetModule(targetWindow) {
  "use strict";

  const CONTRAST_THRESHOLD = 4.5;
  const MAX_CONTRAST_ANCESTORS = 12;

  function parseCssColor(value) {
    if (value && typeof value === "object") {
      const r = Number(value.r), g = Number(value.g), b = Number(value.b);
      const a = value.a == null ? 1 : Number(value.a);
      return [r, g, b, a].every(Number.isFinite)
        ? { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) }
        : null;
    }
    const text = String(value || "").trim().toLowerCase();
    if (!text) return null;
    if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    if (text === "black") return { r: 0, g: 0, b: 0, a: 1 };
    if (text === "white") return { r: 255, g: 255, b: 255, a: 1 };

    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
    if (hex) {
      let digits = hex[1];
      if (digits.length <= 4) digits = [...digits].map((part) => part + part).join("");
      const hasAlpha = digits.length === 8;
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16),
        a: hasAlpha ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
      };
    }

    const parseChannel = (part, max) => {
      if (!part) return null;
      const percent = part.endsWith("%");
      const n = Number(percent ? part.slice(0, -1) : part);
      return Number.isFinite(n) ? clamp(percent ? n * max / 100 : n, 0, max) : null;
    };
    const rgb = /^rgba?\((.*)\)$/i.exec(text);
    if (rgb) {
      const parts = rgb[1].replace(/\s*\/\s*/, " ").replace(/,/g, " ").trim().split(/\s+/);
      if (parts.length < 3 || parts.length > 4) return null;
      const channels = parts.slice(0, 3).map((part) => parseChannel(part, 255));
      const alpha = parts[3] == null ? 1 : parseChannel(parts[3], 1);
      if (channels.some((part) => part == null) || alpha == null) return null;
      return { r: channels[0], g: channels[1], b: channels[2], a: alpha };
    }

    // Recent Gecko may serialize color-mix() as color(srgb ... / alpha).
    const srgb = /^color\(srgb\s+(.+)\)$/i.exec(text);
    if (srgb) {
      const parts = srgb[1].replace(/\s*\/\s*/, " ").trim().split(/\s+/);
      if (parts.length < 3 || parts.length > 4) return null;
      const channels = parts.slice(0, 3).map((part) => parseChannel(part, 1));
      const alpha = parts[3] == null ? 1 : parseChannel(parts[3], 1);
      if (channels.some((part) => part == null) || alpha == null) return null;
      return { r: channels[0] * 255, g: channels[1] * 255, b: channels[2] * 255, a: alpha };
    }
    return null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function compositeColor(foreground, background) {
    const alpha = foreground.a + background.a * (1 - foreground.a);
    if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
      g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
      b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
      a: alpha,
    };
  }

  function linearChannel(value) {
    const n = clamp(value / 255, 0, 1);
    return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(value) {
    const color = parseCssColor(value);
    if (!color) return null;
    return 0.2126 * linearChannel(color.r) +
      0.7152 * linearChannel(color.g) +
      0.0722 * linearChannel(color.b);
  }

  function contrastRatio(foreground, background) {
    const fg = parseCssColor(foreground);
    const bg = parseCssColor(background);
    if (!fg || !bg) return 1;
    const opaqueBg = bg.a < 1 ? compositeColor(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg;
    const opaqueFg = fg.a < 1 ? compositeColor(fg, opaqueBg) : fg;
    const l1 = relativeLuminance(opaqueFg);
    const l2 = relativeLuminance(opaqueBg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function effectiveBackground(element) {
    if (!element) return null;
    const view = element.ownerDocument?.defaultView || targetWindow;
    if (typeof view?.getComputedStyle !== "function") return null;
    let dark = false;
    try { dark = view.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true; } catch (_) {}
    let background = dark
      ? { r: 0, g: 0, b: 0, a: 1 }
      : { r: 255, g: 255, b: 255, a: 1 };
    const ancestors = [];
    for (let node = element; node && ancestors.length < MAX_CONTRAST_ANCESTORS; node = node.parentElement)
      ancestors.push(node);
    for (let i = ancestors.length - 1; i >= 0; i--) {
      try {
        const color = parseCssColor(view.getComputedStyle(ancestors[i])?.backgroundColor);
        if (color) background = compositeColor(color, background);
      } catch (_) {}
    }
    return `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`;
  }

  function applyContrastSafety(element) {
    if (!element || typeof element.setAttribute !== "function")
      return { forced: false, ratio: null, surface: null, background: null };
    const wasForced = element.getAttribute?.("data-zbw-contrast") === "forced";
    const oldSurface = element.getAttribute?.("data-zbw-contrast-surface");
    if (wasForced) {
      element.removeAttribute?.("data-zbw-contrast");
      element.removeAttribute?.("data-zbw-contrast-surface");
    }

    const view = element.ownerDocument?.defaultView || targetWindow;
    const background = effectiveBackground(element);
    const bgColor = parseCssColor(background);
    if (!bgColor) {
      if (wasForced) {
        element.setAttribute("data-zbw-contrast", "forced");
        if (oldSurface) element.setAttribute("data-zbw-contrast-surface", oldSurface);
      }
      return { forced: wasForced, ratio: null, surface: oldSurface || null, background };
    }

    // Check visible text-bearing descendants too (notably the warning-colored RAM value), so a healthy card
    // foreground cannot mask a lower-contrast label, action or toast. This is a bounded DOM walk on paints only.
    const targets = [element];
    try {
      for (const child of element.querySelectorAll?.(
        ".zbw-value, .zbw-label, .zbw-action, .zbw-action-count, .zbw-toast-line, .zbw-toast-action") || [])
        targets.push(child);
    } catch (_) {}
    let ratio = null;
    for (const target of targets) {
      let foreground = null;
      try { foreground = parseCssColor(view?.getComputedStyle?.(target)?.color); } catch (_) {}
      const targetBackground = effectiveBackground(target);
      if (!foreground || !targetBackground) continue;
      const current = contrastRatio(foreground, targetBackground);
      ratio = ratio == null ? current : Math.min(ratio, current);
    }
    if (ratio == null) {
      if (wasForced) {
        element.setAttribute("data-zbw-contrast", "forced");
        if (oldSurface) element.setAttribute("data-zbw-contrast-surface", oldSurface);
      }
      return { forced: wasForced, ratio: null, surface: oldSurface || null, background };
    }

    const forced = ratio < CONTRAST_THRESHOLD;
    const surface = relativeLuminance(bgColor) < 0.5 ? "dark" : "light";
    if (forced) {
      element.setAttribute("data-zbw-contrast", "forced");
      element.setAttribute("data-zbw-contrast-surface", surface);
    } else {
      element.removeAttribute("data-zbw-contrast");
      element.removeAttribute("data-zbw-contrast-surface");
    }
    return { forced, ratio, surface: forced ? surface : null, background };
  }

  function restoreBadgeText(value) {
    let count = 0;
    try { count = Math.floor(Number(value)); } catch (_) { return ""; }
    if (!Number.isFinite(count) || count < 1) return "";
    return count > 99 ? "99+" : String(count);
  }

  function mountBoostWidget(options = {}) {
    const window = options.window || targetWindow;
    const doc = options.document || window.document;
    if (!doc?.documentElement || doc.documentElement.nodeType !== 1 ||
        typeof doc.createElement !== "function" || typeof doc.documentElement.appendChild !== "function")
      return () => {};
    const runtime = options.runtime || window.ZentralRuntime || window.__zentralStandaloneRuntime;
    const lifecycle = options.lifecycle;
    const adapter = options.adapter || {};
    const isEnabled = typeof options.isEnabled === "function" ? options.isEnabled : () => true;
    const MARKER = "__zentralBoostWidget";
    const CARD_ID = "zentral-boost-widget";
    const ANCHOR_ID = "zentral-boost-widget-anchor";
    const TRAY_ID = "zentral-sidebar-widgets";
    const TOAST_MS = 4000;
    const sidebarMount = window.__zentralSidebarMount || null;
    const chooseBottomMount = adapter.chooseBottomMount || sidebarMount?.chooseBottomMount;
    const SEAT_ANCHOR_IDS = Array.isArray(sidebarMount?.anchorIds)
      ? sidebarMount.anchorIds
      : ["zen-media-controls-toolbar", "zen-sidebar-bottom-buttons", "tabbrowser-tabs", "vertical-tabs"];
    const VIDEO_PLAYER_ID = sidebarMount?.videoPlayerId || "zentral-video-preview";
    const markerState = { disposed: false };
    const cardInstances = new Set();
    const setTimer = typeof adapter.setTimeout === "function"
      ? adapter.setTimeout
      : (fn, ms) => lifecycle.setTimeout(fn, ms);
    const clearTimer = typeof adapter.clearTimeout === "function"
      ? adapter.clearTimeout
      : (id) => lifecycle.clearTimeout(id);
    const own = typeof adapter.own === "function"
      ? adapter.own
      : (fn) => lifecycle.own(fn);
    const listen = typeof adapter.listen === "function"
      ? adapter.listen
      : (target, type, fn, listenerOptions) => lifecycle.listen(target, type, fn, listenerOptions);
    let disposed = false;
    let decisionTimer = null;
    let seatTimer = null;
    let hostUnregister = null;
    let ownCardCleanup = null;
    let flowCleanup = null;
    let flowTile = null;
    let flowCard = null;
    let flowVisibility = null;
    let mountObserver = null;
    let mountHost = null;
    let observedMountHost = null;
    let flowTrackingStarted = false;
    const flowTrackingReleases = [];
    let enabledUnregister = null;
    let hover = null;
    let anchor = null;
    let marker = null;

    const consoleWarn = (...args) => {
      try { window.console?.warn?.("[Zentral Boost widget]", ...args); } catch (_) {}
    };
    const boostApi = () => options.api || window.ZentralBoost || null;
    const enabled = () => !disposed && isEnabled() === true;
    const language = () => {
      const raw = window.navigator?.language || window.navigator?.userLanguage || "en";
      const api = boostApi();
      return typeof api?.widgetLanguage === "function"
        ? api.widgetLanguage(raw)
        : String(raw).toLowerCase().startsWith("pl") ? "pl" : "en";
    };
    const text = (key, params = null) => {
      const api = boostApi();
      if (typeof api?.widgetText === "function") return api.widgetText(language(), key, params);
      if (key === "card.title") return "Memory Boost";
      if (key === "card.unknown") return "RAM unknown";
      return String(key);
    };
    const number = (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
    };
    const valueParts = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      return {
        mb: Math.round(n),
        text: n >= 1000 ? (Math.round(n / 100) / 10).toFixed(1) + " GB" : Math.round(n) + " MB",
        level: n >= 4096 ? "low" : "ok",
      };
    };
    const normalizeSnapshot = (snapshot) => {
      const s = snapshot && typeof snapshot === "object" ? snapshot : {};
      const tabs = number(s.tabs ?? s.restorableTabs, 0);
      return { ...s, panels: number(s.panels, 0), tabs, restorableTabs: number(s.restorableTabs ?? s.tabs, 0) };
    };
    const snapshotOf = (api = boostApi()) => {
      let game = null;
      let session = null;
      try { game = typeof api?.gameModeState === "function" ? api.gameModeState() : null; } catch (_) {}
      try { session = typeof api?.sessionState === "function" ? api.sessionState() : null; } catch (_) {}
      return normalizeSnapshot(game?.snapshot || session || {});
    };
    const restorableCount = (snapshot) => number(snapshot?.panels, 0) + number(snapshot?.tabs, 0);
function fallbackFeedbackText(state) {
  const src = state && typeof state === "object" ? state : {};
  const unloaded = src.unloaded && typeof src.unloaded === "object" ? src.unloaded : {};
  const kept = Array.isArray(src.kept) ? src.kept : [];
  const names = kept.slice(0, 3).map((entry) => {
    const row = entry && typeof entry === "object" ? entry : { id: entry };
    return String(row.id || row.kind || "tab") + " (" + String(row.reason || "kept") + ")";
  });
  if (kept.length > 3) names.push(text("feedback.keptMore", { count: kept.length - 3 }));
  return text("feedback.gameOn", {
    mb: number(src.freedMB ?? src.finalFreedMB, 0),
    tabs: number(unloaded.tabs, 0),
    panels: number(unloaded.panels, 0),
    kept: names.length ? names.join(", ") : text("feedback.keptNone"),
  });
}
function fallbackOffText(snapshot) {
  const line = text("feedback.gameOff");
  const label = restorableCount(snapshot)
    ? text("card.restoreLabel", { panels: number(snapshot.panels, 0), tabs: number(snapshot.tabs, 0) })
    : text("card.nothingRestore");
  return restorableCount(snapshot) ? line + " \u00b7 " + label : line;
}

function fallbackMenu(api, snapshot, previewLine = "") {
  const lang = language();
  const t = (key, params) => text(key, params);
  const gameOn = Boolean(api?.gameModeState?.()?.on);
  const count = restorableCount(snapshot);
  return [
    { id: "free-light", level: "light", shortLabel: t("card.light"), label: t("card.light"), hint: t("card.lightHint"), available: true },
    { id: "free-deep", level: "deep", shortLabel: t("card.deep"), label: t("card.deep"), hint: t("card.deepHint"), available: Boolean(api?.runLevel2) },
    { id: "game-mode", level: "game", shortLabel: t("card.game"), label: t("card.game"), hint: previewLine || t(gameOn ? "card.gameHintOn" : "card.gameHint"), available: Boolean(api?.setGameMode), checked: gameOn },
    { id: "restore", level: "restore", shortLabel: t("card.restore"), label: count ? api?.widgetRestoreLabel?.(snapshot, lang) || t("card.restoreLabel", { panels: number(snapshot.panels, 0), tabs: number(snapshot.tabs ?? snapshot.restorableTabs, 0) }) : t("card.nothingRestore"), hint: count ? t("card.restoreHint") : t("card.nothingRestore"), available: count > 0 && Boolean(api?.restoreSession || api?.restore) },
  ];
}

function menuItems(api, snapshot, previewLine = "", actionRunning = false) {
  const lang = language();
  const state = typeof api?.state === "function" ? api.state() : {};
  const game = typeof api?.gameModeState === "function" ? api.gameModeState() : { on: false };
  const options = {
    previewHint: previewLine,
    running: Boolean(state.level2Busy || actionRunning),
    canDeep: state.policy !== false,
    canGameMode: typeof api?.setGameMode === "function",
    canRestore: typeof api?.restoreSession === "function" || typeof api?.restore === "function",
    gameMode: game,
    snapshot,
    language: lang,
    undoSize: number(state.undoSize, 0),
    skipped: state.lastSkipped,
    loadedTabs: state.loadedTabs,
    restoreLabel: typeof api?.widgetRestoreLabel === "function" ? api.widgetRestoreLabel(snapshot, lang) : "",
  };
  const items = typeof api?.widgetMenu === "function" ? api.widgetMenu(options) : fallbackMenu(api, snapshot, previewLine);
  return Array.isArray(items) ? items : fallbackMenu(api, snapshot, previewLine);
}

function createCard({ root, mode }) {
  const lang = language();
  const cardReleases = [];
  const actionReleases = [];
  let actionToastRelease = null;
  let toastTimer = null;
  let running = false;
  let subscribed = false;
  let sampling = false;
  let samplingApi = null;
  let unsubChange = null;
  let unsubLimiterEvents = null;
  let unsubGameModeEvents = null;
  let gameModeEventCount = 0;
  let cardDisposed = false;

  const ownListen = (target, type, fn, options, bucket = cardReleases) => {
    if (!target || typeof target.addEventListener !== "function") return () => {};
    const release = listen(target, type, fn, options);
    bucket.push(release);
    return release;
  };
  const clearActions = () => {
    for (const release of actionReleases.splice(0).reverse()) {
      try { release(); } catch (_) {}
    }
    while (root.querySelector?.("[data-zbw-action]")) {
      const node = root.querySelector("[data-zbw-action]");
      node.remove();
    }
    const popup = root.querySelector?.(".zbw-popup");
    if (popup) while (popup.children?.length) popup.children[0].remove();
  };
  const clearToast = () => {
    if (toastTimer !== null) {
      clearTimer(toastTimer);
      toastTimer = null;
    }
    if (actionToastRelease) {
      try { actionToastRelease(); } catch (_) {}
      actionToastRelease = null;
    }
    const toast = root.querySelector?.(".zbw-toast");
    if (toast) {
      while (toast.children?.length) toast.children[0].remove();
      toast.textContent = "";
      toast.hidden = true;
    }
  };

  root.id = CARD_ID;
  root.setAttribute("class", "zbw-card " + (mode === "flow" ? "zbw-flow" : "zbw-fallback zentral-boost-widget-fallback"));
  root.setAttribute("data-zbw-mount", mode === "flow" ? "flow" : "fallback");
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", text("card.title"));
  const row = doc.createElement("div");
  row.className = "zbw-row";
  const header = doc.createElement("div");
  header.className = "zbw-header";
  const valueEl = doc.createElement("span");
  valueEl.className = "zbw-value";
  valueEl.textContent = "\u2014";
  const labelEl = doc.createElement("span");
  labelEl.className = "zbw-label";
  labelEl.textContent = text("card.title");
  const popup = doc.createElement("div");
  popup.className = "zbw-popup";
  popup.setAttribute("role", "group");
  popup.setAttribute("aria-label", "Boost levels and Restore");
  popup.hidden = false;
  header.appendChild(valueEl);
  header.appendChild(labelEl);
  row.appendChild(header);
  row.appendChild(popup);
  root.appendChild(row);
  const toastEl = doc.createElement("div");
  toastEl.className = "zbw-toast";
  toastEl.setAttribute("role", "status");
  toastEl.hidden = true;
  root.appendChild(toastEl);

  function updateContrast() {
    if (cardDisposed) return;
    applyContrastSafety(root);
  }

  function paintValue() {
    const api = boostApi();
    let mb = null;
    try { mb = typeof api?.lastMB === "function" ? api.lastMB() : null; } catch (_) {}
    if (!Number.isFinite(Number(mb)) || Number(mb) <= 0) {
      try { mb = typeof api?.memoryMB === "function" ? api.memoryMB() : null; } catch (_) {}
    }
    const parts = valueParts(mb);
    valueEl.textContent = parts ? parts.text : "\u2014";
    valueEl.setAttribute("data-zbw-level", parts ? parts.level : "muted");
    root.setAttribute("data-zbw-value", parts ? String(parts.mb) : "");
    root.setAttribute("aria-label", parts
      ? parts.text + " \u00b7 " + text("card.title")
      : text("card.unknown"));
    updateContrast();
  }

  function computePreviewLine() {
    const api = boostApi();
    if (!api || typeof api.previewGameMode !== "function" || api.gameModeState?.()?.on) return "";
    let preview = null;
    try { preview = api.previewGameMode(); } catch (_) { preview = null; }
    return typeof api.widgetPreviewText === "function"
      ? api.widgetPreviewText(preview, language())
      : text("card.preview", { tabs: number(preview?.counts?.tabs, 0), panels: number(preview?.counts?.panels, 0) });
  }

  function previewHint(button = null) {
    const line = computePreviewLine();
    if (!line) return "";
    const target = button || root.querySelector?.('[data-zbw-action="game-mode"]');
    if (!target) return line;
    const baseTitle = target.getAttribute("data-zbw-base-title") || target.getAttribute("title") || "";
    target.setAttribute("data-zbw-preview", line);
    target.setAttribute("aria-description", line);
    target.setAttribute("title", [baseTitle, line].filter(Boolean).join(" · "));
    return line;
  }

  function clearPreview(button = null) {
    const target = button || root.querySelector?.('[data-zbw-action="game-mode"]');
    if (!target) return;
    const baseTitle = target.getAttribute("data-zbw-base-title") || "";
    target.setAttribute("title", baseTitle);
    target.removeAttribute("data-zbw-preview");
    target.removeAttribute("aria-description");
  }

  function paintMenu() {
    clearActions();
    const api = boostApi();
    const snapshot = snapshotOf(api);
    const items = menuItems(api, snapshot, "", running);
    const skippedInfo = items.find((item) => item.id === "deep-skipped");
    for (const item of items) {
      if (item.id === "deep-skipped") continue;
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "zbw-action";
      button.setAttribute("data-zbw-action", item.id);
      if (item.level) button.setAttribute("data-zbw-level", item.level);
      const shortLabel = item.shortLabel || item.label || item.id;
      const gameModeOn = item.id === "game-mode" && item.checked === true;
      button.textContent = (gameModeOn ? "● " : "") + shortLabel;
      button.setAttribute("aria-label", item.label || item.shortLabel || item.id);
      const hints = [item.description, item.hint];
      if (item.id === "free-deep" && skippedInfo) hints.push(skippedInfo.label, skippedInfo.hint);
      if (item.id === "restore" && item.label) hints.unshift(item.label);
      const title = hints.filter(Boolean).join(" · ");
      if (title) button.setAttribute("title", title);
      if (item.id === "game-mode") button.setAttribute("data-zbw-base-title", title);
      if (item.checked !== undefined) {
        button.setAttribute("role", "switch");
        button.setAttribute("aria-checked", item.checked ? "true" : "false");
      }
      const badgeText = item.id === "restore" ? restoreBadgeText(restorableCount(snapshot)) : "";
      if (badgeText) {
        const badge = doc.createElement("span");
        badge.className = "zbw-action-count";
        badge.setAttribute("aria-hidden", "true");
        badge.textContent = badgeText;
        button.appendChild(badge);
      }
      button.disabled = item.available === false;
      button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
      if (item.available !== false) {
        ownListen(button, "click", (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          void runAction(item.id);
        }, undefined, actionReleases);
        if (item.id === "game-mode") {
          ownListen(button, "mouseenter", () => previewHint(button), undefined, actionReleases);
          ownListen(button, "focus", () => previewHint(button), undefined, actionReleases);
          ownListen(button, "mouseleave", () => clearPreview(button), undefined, actionReleases);
          ownListen(button, "blur", () => clearPreview(button), undefined, actionReleases);
        }
      }
      popup.appendChild(button);
    }
    updateContrast();
  }

  // G7: one event door from the Boost module. The card never asks for a second measurement; it paints the
  // dry-run hint, the G8 settled/final report and the OFF Restore toast from the state Boost already owns.
  function handleGameModeEvent(event) {
    const api = boostApi();
    const action = String(event?.action || "");
    if (action === "on") {
      gameModeEventCount += 1;
      showToast(text("feedback.gameStarting"));
      return;
    }
    if (action === "on-settle" || action === "on-final") {
      const state = event?.state || (typeof api?.gameModeState === "function" ? api.gameModeState() : {});
      const line = typeof api?.widgetFeedbackText === "function"
        ? api.widgetFeedbackText(state, language())
        : fallbackFeedbackText(state);
      showToast(line);
      paintMenu();
      return;
    }
    if (action === "off") {
      gameModeEventCount += 1;
      const snapshot = normalizeSnapshot(event?.state?.snapshot || snapshotOf(api));
      const line = typeof api?.widgetOffText === "function"
        ? api.widgetOffText(snapshot, language())
        : fallbackOffText(snapshot);
      const restoreAction = restorableCount(snapshot)
        ? { label: text("feedback.restoreAction"), run: () => { void runAction("restore"); } }
        : null;
      showToast(line, restoreAction);
      paintMenu();
      return;
    }
    if (action === "restored") paintMenu();
  }

  function handleLimiterEvent(event) {
    const action = String(event?.action || "");
    if (action === "notify") {
      showToast(text("card.limitHit", {
        mb: Math.round(Number(event.totalMB) || 0),
        limit: Math.round(Number(event.limitMB) || 0),
      }));
    } else if (action === "hard-done") {
      const unloaded = event.unloaded || {};
      if (unloaded.tabs || unloaded.panels)
        showToast(text("card.limitDone", { mb: Math.round(Number(event.totalMB) || 0) }));
    } else if (action === "nothing-eligible") {
      showToast(text("card.limitNothing"));
    }
  }

  function subscribeLimiterEvents() {
    if (cardDisposed || unsubLimiterEvents) return;
    const api = boostApi();
    if (!api || typeof api.onLimiterEvent !== "function") return;
    try {
      unsubLimiterEvents = api.onLimiterEvent(handleLimiterEvent);
    } catch (_) {
      unsubLimiterEvents = null;
    }
  }
  function releaseLimiterEvents() {
    if (unsubLimiterEvents) {
      try { unsubLimiterEvents(); } catch (_) {}
      unsubLimiterEvents = null;
    }
  }

  function subscribeGameModeEvents() {
    if (cardDisposed || unsubGameModeEvents) return;
    const api = boostApi();
    if (!api || typeof api.onGameModeEvent !== "function") return;
    try {
      unsubGameModeEvents = api.onGameModeEvent(handleGameModeEvent);
    } catch (_) {
      unsubGameModeEvents = null;
    }
  }
  function releaseGameModeEvents() {
    if (unsubGameModeEvents) {
      try { unsubGameModeEvents(); } catch (_) {}
      unsubGameModeEvents = null;
    }
  }

  function showToast(message, action = null) {
    clearToast();
    toastEl.textContent = "";
    toastEl.hidden = false;
    const line = doc.createElement("span");
    line.className = "zbw-toast-line";
    line.textContent = String(message || "");
    toastEl.appendChild(line);
    if (action && typeof action.run === "function") {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "zbw-toast-action";
      button.textContent = action.label || text("card.restore");
      actionToastRelease = ownListen(button, "click", (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        action.run();
      });
      toastEl.appendChild(button);
    }
    updateContrast();
    toastTimer = setTimer(() => {
      toastTimer = null;
      clearToast();
    }, TOAST_MS);
  }

  async function runCleanAction(api, run) {
    if (running) return null;
    running = true;
    paintMenu();
    showToast(text("card.busy"));
    let result = null;
    try { result = await run(); } catch (_) { result = null; }
    running = false;
    paintValue();
    paintMenu();
    showToast(typeof api.widgetResultText === "function"
      ? api.widgetResultText(result, language())
      : text("card.result", { mb: number(result?.freedMB, 0) }));
    return result;
  }

  async function runAction(id) {
    const api = boostApi();
    if (!api || (running && id !== "game-mode")) return null;
    if (id === "free-light" && typeof api.runLevel1 === "function")
      return runCleanAction(api, () => api.runLevel1());
    if (id === "free-deep" && typeof api.runLevel2 === "function")
      return runCleanAction(api, () => api.runLevel2());
    if (id === "game-mode" && typeof api.setGameMode === "function") {
      previewHint(root.querySelector?.('[data-zbw-action="game-mode"]'));
      const next = !Boolean(api.gameModeState?.()?.on);
      const eventsBefore = gameModeEventCount;
      let result = null;
      try { result = api.setGameMode(next); } catch (_) { result = null; }
      if (gameModeEventCount === eventsBefore)
        showToast(text(next ? "card.gameOn" : "card.gameOff"));
      paintMenu();
      return result;
    }
    if (id === "restore") {
      let result = null;
      try {
        result = typeof api.restoreSession === "function" ? api.restoreSession() : api.restore?.();
      } catch (_) { result = null; }
      paintMenu();
      if (result?.panels)
        showToast(text("card.restored", { count: number(result.panels, 0) }));
      else if (result?.tabs)
        showToast(text("card.restoredTabs", { count: number(result.tabs, 0) }));
      return result;
    }
    return null;
  }

  function start() {
    if (cardDisposed || (mode === "flow" && (root.hidden || root.isConnected === false || !enabled()))) return;
    const api = boostApi();
    if (!api) return;
    if (!subscribed && typeof api.onChange === "function") {
      try {
        unsubChange = api.onChange(() => paintValue());
        subscribed = true;
      } catch (_) { unsubChange = null; subscribed = false; }
    }
    if (!sampling && typeof api.startSampling === "function") {
      // Capture the API: the shim disposes the Boost feature before extras cleanup, so a later
      // window.ZentralBoost lookup would be null and stopSampling() would be missed.
      try { api.startSampling(); sampling = true; samplingApi = api; } catch (_) { sampling = false; samplingApi = null; }
    }
    subscribeLimiterEvents();
    subscribeGameModeEvents();
  }
  function stop() {
    releaseLimiterEvents();
    releaseGameModeEvents();
    const api = samplingApi || boostApi();
    if (sampling) {
      try { api?.stopSampling?.(); } catch (_) {}
      sampling = false;
      samplingApi = null;
    }
    if (unsubChange) {
      try { unsubChange(); } catch (_) {}
      unsubChange = null;
    }
    subscribed = false;
  }
  function refresh() {
    if (cardDisposed) return;
    start();
    paintValue();
    paintMenu();
  }
  function teardown() {
    if (cardDisposed) return;
    cardDisposed = true;
    stop();
    clearToast();
    clearActions();
    for (const release of cardReleases.splice(0).reverse()) {
      try { release(); } catch (_) {}
    }
    cardInstances.delete(instance);
  }
  const instance = {
    element: root,
    fetch() {
      refresh();
      const api = boostApi();
      return { mb: typeof api?.lastMB === "function" ? api.lastMB() : null, available: Boolean(api) };
    },
    render: refresh,
    refresh,
    paintValue,
    paintMenu,
    runAction,
    showToast,
    previewHint,
    start,
    stop,
    dispose: teardown,
  };
  cardInstances.add(instance);
  ownListen(doc, "keydown", (event) => {
    if (event?.key !== "Escape") return;
    clearPreview();
    clearToast();
  });
  ownListen(window, "zen-workspace-switched", updateContrast);
  try {
    const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (colorScheme?.addEventListener) {
      ownListen(colorScheme, "change", updateContrast);
    } else if (colorScheme?.addListener) {
      colorScheme.addListener(updateContrast);
      cardReleases.push(() => colorScheme.removeListener?.(updateContrast));
    }
  } catch (_) {}
  updateContrast();
  refresh();
  return instance;
}

function destroyOwnCard() {
  if (ownCardCleanup) {
    try { ownCardCleanup(); } catch (error) { consoleWarn("card cleanup failed", error); }
    ownCardCleanup = null;
  }
  hover = null;
  anchor = null;
}

function createSelfCard() {
  if (ownCardCleanup || !enabled()) return;
  if (!doc || typeof doc.createElement !== "function" || typeof doc.documentElement?.append !== "function") return;
  const createHover = adapter.createSidebarHoverCard || runtime?.createSidebarHoverCard;
  if (typeof createHover !== "function") return;
  let card = null;
  const localAnchor = doc.createElement("button");
  localAnchor.type = "button";
  localAnchor.id = ANCHOR_ID;
  localAnchor.className = "zbw-anchor";
  localAnchor.setAttribute("aria-label", text("card.title"));
  localAnchor.textContent = text("card.title");
  const sidebarRect = () => {
    try {
      if (typeof adapter.getSidebarRect === "function") return adapter.getSidebarRect() || {};
      return runtime?.nativeSidebarRect?.() || {};
    } catch (_) { return {}; }
  };
  const rect = sidebarRect();
  localAnchor.style.left = Math.max(4, number(rect.left, 4)) + "px";
  localAnchor.style.top = Math.max(4, number(rect.top, 4)) + "px";
  doc.documentElement.appendChild(localAnchor);

  const localHover = createHover.call(runtime, {
    window,
    document: doc,
    id: CARD_ID,
    className: "zentral-boost-widget-fallback",
    role: "group",
    ariaLabel: text("card.title"),
    defaultWidth: 300,
    defaultHeight: 96,
    getShowDelay: () => 0,
    getHideDelay: () => 0,
    getGap: () => 6,
    getSide: () => "auto",
    getBounds: () => {
      const r = sidebarRect();
      return { left: number(r.left, 0), right: number(r.right, window.innerWidth || 1200) };
    },
    isEnabled: () => enabled(),
    isValid: (target) => Boolean(target && target.isConnected !== false),
    setTimer,
    clearTimer,
    onCreate(node) {
      card = createCard({ root: node, mode: "fallback" });
    },
    render() {
      card?.refresh();
    },
    onShow() {
      card?.start();
    },
    onHide() {
      card?.stop();
    },
  });
  const releaseHover = own(() => {
    try { localHover.destroy(); } catch (_) {}
  });
  const releaseAnchor = own(() => {
    try { localAnchor.remove(); } catch (_) {}
  });
  const releaseCard = own(() => {
    try { card?.dispose(); } catch (_) {}
    card = null;
  });
  ownListenSelf(localAnchor, "mouseenter", () => localHover.show(localAnchor));
  ownListenSelf(localAnchor, "focus", () => localHover.show(localAnchor));
  ownListenSelf(window, "resize", () => localHover.position());
  ownCardCleanup = own(() => {
    for (const release of [...selfListenerReleases].reverse()) {
      try { release(); } catch (_) {}
    }
    selfListenerReleases.clear();
    releaseCard();
    releaseHover();
    releaseAnchor();
    hover = null;
    anchor = null;
  });
  hover = localHover;
  anchor = localAnchor;
  try {
    localHover.show(localAnchor);
  } catch (error) {
    consoleWarn("fallback card failed", error);
    destroyOwnCard();
  }
}

const selfListenerReleases = new Set();
function ownListenSelf(target, type, fn, options) {
  if (!target || typeof target.addEventListener !== "function") return () => {};
  const release = listen(target, type, fn, options);
  selfListenerReleases.add(release);
  return () => {
    selfListenerReleases.delete(release);
    try { release(); } catch (_) {}
  };
}

function isWindowHidden() {
  return Boolean(
    doc?.hidden ||
      (Number.isFinite(window?.STATE_MINIMIZED) &&
        window?.windowState === window?.STATE_MINIMIZED),
  );
}

function shouldHideFlowCard() {
  return !enabled() || isWindowHidden();
}

function safeFlowMountTarget() {
  if (typeof chooseBottomMount !== "function") return null;
  let fallbackSidebar = null;
  try { fallbackSidebar = runtime?.nativeSidebarElement?.() || null; } catch (_) {}
  let target = null;
  try { target = chooseBottomMount(doc, window, fallbackSidebar); } catch (_) { target = null; }
  if (!target?.parent || target.parent.nodeType !== 1) return null;
  if (target.before && target.before.parentNode !== target.parent) return null;

  const video = doc?.getElementById?.(VIDEO_PLAYER_ID);
  for (let node = target.parent; node; node = node.parentElement) {
    if (node === video) return null;
  }
  if (target.before && target.before.id === VIDEO_PLAYER_ID &&
      SEAT_ANCHOR_IDS.includes(target.before.previousSibling?.id)) {
    target = {
      ...target,
      before: target.before.nextSibling || null,
      anchorId: VIDEO_PLAYER_ID + ":after",
    };
  }

  const tray = doc?.getElementById?.(TRAY_ID);
  if (tray?.parentNode === target.parent && tray !== flowTile) {
    target = {
      ...target,
      before: tray.nextSibling || null,
      anchorId: String(target.anchorId || "sidebar") + ":after-tray",
    };
  }

  // The tray adjustment can put the video player back in `before` (tray -> video).
  // Re-apply the adjacency guard so the tile stays after the player, never between them.
  if (target.before?.id === VIDEO_PLAYER_ID) {
    const previous = target.before.previousSibling;
    if (SEAT_ANCHOR_IDS.includes(previous?.id) || previous === tray) {
      target = {
        ...target,
        before: target.before.nextSibling || null,
        anchorId: VIDEO_PLAYER_ID + ":after",
      };
    }
  }
  return target;
}

function positionFlowTile(target) {
  if (!flowTile || !target?.parent) return false;
  const before = target.before && target.before.parentNode === target.parent
    ? target.before
    : null;
  const alreadyInPlace = flowTile.parentNode === target.parent &&
    (before === flowTile || flowTile.nextSibling === before);
  if (alreadyInPlace) return true;
  try {
    if (before) target.parent.insertBefore(flowTile, before);
    else target.parent.appendChild(flowTile);
    return flowTile.parentNode === target.parent;
  } catch (error) {
    consoleWarn("could not seat the in-flow card", error);
    return false;
  }
}

function updateFlowVisibility() {
  if (!flowTile) return;
  const hidden = shouldHideFlowCard();
  flowTile.hidden = hidden;
  if (flowVisibility === hidden) return;
  flowVisibility = hidden;
  if (hidden) flowCard?.stop();
  else flowCard?.refresh();
}

function ensureFlowCard(target) {
  if (!flowTile) {
    flowTile = doc.createElement("div");
    flowTile.hidden = shouldHideFlowCard();
    flowVisibility = flowTile.hidden;
  }
  mountHost = target.parent;
  if (!positionFlowTile(target)) {
    flowTile.hidden = true;
    flowVisibility = true;
    flowCard?.stop();
    return false;
  }
  if (!flowCard) {
    try {
      flowCard = createCard({ root: flowTile, mode: "flow" });
      if (!flowCleanup) flowCleanup = own(destroyFlowCard);
    } catch (error) {
      consoleWarn("could not create the in-flow card", error);
      flowTile.remove();
      flowTile = null;
      flowCard = null;
      flowVisibility = null;
      mountHost = null;
      return false;
    }
  }
  updateFlowVisibility();
  return true;
}

function destroyFlowCard() {
  if (flowCard) {
    try { flowCard.dispose(); } catch (_) {}
    flowCard = null;
  }
  try { flowTile?.remove?.(); } catch (_) {}
  flowTile = null;
  flowVisibility = null;
  mountHost = null;
}

function isOwnCardMutation(record) {
  if (!flowTile || !record) return false;
  if (record.target === flowTile || flowTile.contains?.(record.target)) return true;
  if (record.type !== "childList") return false;
  const changed = [...(record.addedNodes || []), ...(record.removedNodes || [])];
  return Boolean(
    changed.length &&
      changed.every((node) => node === flowTile || flowTile.contains?.(node)) &&
      flowTile.isConnected !== false &&
      flowTile.parentNode === mountHost,
  );
}

function reconnectMountObserver() {
  if (!mountObserver) return;
  const nextHost = mountHost?.nodeType === 1 ? mountHost : doc?.documentElement;
  if (observedMountHost === nextHost) return;
  try { mountObserver.disconnect(); } catch (_) {}
  observedMountHost = nextHost || null;
  if (!nextHost) return;
  try {
    // Observe only direct children of the mount host: a child mutation can
    // replace/reparent an anchor, while our tile's internal DOM is invisible.
    mountObserver.observe(nextHost, { childList: true });
  } catch (_) {}
}

function destroyFlowMount() {
  if (typeof flowCleanup === "function") {
    const release = flowCleanup;
    flowCleanup = null;
    try { release(); } catch (_) { destroyFlowCard(); }
  } else {
    destroyFlowCard();
  }
}

function seatFlowCard() {
  if (disposed) return;
  if (!enabled()) {
    mountHost = null;
    destroyOwnCard();
    destroyFlowMount();
    stopFlowMountTracking();
    return;
  }

  const target = safeFlowMountTarget();
  if (!target) {
    mountHost = null;
    destroyFlowMount();
    createSelfCard();
    reconnectMountObserver();
    return;
  }

  destroyOwnCard();
  mountHost = target.parent;
  if (!ensureFlowCard(target)) {
    mountHost = null;
    destroyFlowMount();
    createSelfCard();
  }
  reconnectMountObserver();
}

function scheduleMount() {
  if (disposed || seatTimer !== null) return;
  seatTimer = setTimer(() => {
    seatTimer = null;
    if (disposed || lifecycle?.active === false) return;
    seatFlowCard();
  }, 0);
}

function startFlowMountTracking() {
  if (disposed || flowTrackingStarted || !enabled()) return;
  flowTrackingStarted = true;
  const Observer = window.MutationObserver;
  if (typeof Observer === "function") {
    try {
      mountObserver = new Observer((records) => {
        if (disposed || !records?.some((record) => !isOwnCardMutation(record))) return;
        scheduleMount();
      });
      reconnectMountObserver();
    } catch (_) {
      mountObserver = null;
    }
  }
  for (const [target, type] of [
    [window, "resize"],
    [window, "sizemodechange"],
    [window, "zen-workspace-switched"],
    [doc, "visibilitychange"],
  ]) {
    if (!target || (target === doc && typeof doc.addEventListener !== "function")) continue;
    const release = listen(target, type, scheduleMount);
    if (typeof release === "function") flowTrackingReleases.push(release);
  }
}

function stopFlowMountTracking() {
  try { mountObserver?.disconnect?.(); } catch (_) {}
  mountObserver = null;
  observedMountHost = null;
  for (const release of flowTrackingReleases.splice(0).reverse()) {
    try { release(); } catch (_) {}
  }
  flowTrackingStarted = false;
}

function onEnabledChanged() {
  if (disposed) return;
  if (enabled()) startFlowMountTracking();
  scheduleMount();
}

function fullCleanup() {
  if (disposed) return;
  disposed = true;
  markerState.disposed = true;
  if (decisionTimer !== null) {
    clearTimer(decisionTimer);
    decisionTimer = null;
  }
  if (seatTimer !== null) {
    clearTimer(seatTimer);
    seatTimer = null;
  }
  stopFlowMountTracking();
  if (typeof enabledUnregister === "function") {
    try { enabledUnregister(); } catch (_) {}
    enabledUnregister = null;
  }
  destroyOwnCard();
  if (typeof flowCleanup === "function") {
    const release = flowCleanup;
    flowCleanup = null;
    try { release(); } catch (_) { destroyFlowCard(); }
  } else {
    destroyFlowCard();
  }
  for (const instance of [...cardInstances]) {
    try { instance.dispose(); } catch (_) {}
  }
  cardInstances.clear();
  if (typeof hostUnregister === "function") {
    try { hostUnregister(); } catch (_) {}
    hostUnregister = null;
  }
  if (window[MARKER] === marker) delete window[MARKER];
}

const previous = window[MARKER];
try { previous?.destroy?.(); } catch (_) {}
marker = { destroy: fullCleanup };
window[MARKER] = marker;
const registerHostUnload = adapter.registerHostUnload || runtime?.registerHostUnload;
if (typeof registerHostUnload === "function") {
  try {
    hostUnregister = registerHostUnload.call(runtime, fullCleanup);
  } catch (error) {
    consoleWarn("host unload registration failed", error);
  }
}
if (typeof adapter.observeEnabledChange === "function") {
  try {
    enabledUnregister = adapter.observeEnabledChange(onEnabledChanged);
  } catch (error) {
    consoleWarn("enabled-state observer failed", error);
  }
}
decisionTimer = setTimer(() => {
  decisionTimer = null;
  if (disposed || lifecycle?.active === false || !enabled()) return;
  startFlowMountTracking();
  scheduleMount();
}, 0);
return fullCleanup;
  }

  targetWindow.__zentralBoostWidgetModule = Object.freeze({
    mount: mountBoostWidget,
    contrastRatio,
    effectiveBackground,
    applyContrastSafety,
    restoreBadgeText,
  });
})(window);
