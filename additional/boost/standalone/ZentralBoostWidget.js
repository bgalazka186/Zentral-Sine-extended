/* Standalone-only Boost card (G10). This file is the BODY of an `extras` function
 * `(window, runtime, lifecycle)`; tools/build-standalone.cjs embeds it in
 * ZentralBoost.standalone.uc.js. It is never loaded by the full pack.
 *
 * Ownership: with only additional/boost/ installed, Boost draws ONE compact card
 * through the shim's sidebar-hover helper. If the standalone Widgets tray is
 * installed first, Boost registers ONE `boost` widget with the tray instead. If
 * Boost is installed first, it publishes a marker; the later tray calls
 * takeOver(), removes the self-contained card and registers the same definition.
 * The full pack short-circuits the whole standalone bundle, so it never sees
 * this file.
 *
 * There is no setInterval, polling or permanent document observer. Every DOM
 * node, listener, one-shot timer, onChange subscription and startSampling() is
 * released by the returned cleanup and by the shim's window-unload hook.
 */
const doc = window.document;
const MARKER = "__zentralBoostStandaloneWidget";
const CARD_ID = "zentral-boost-standalone-card";
const ANCHOR_ID = "zentral-boost-standalone-anchor";
const BOOST_ENABLED = "zen.workspace.zentral.boost.enabled";
const WIDGET_ENABLED = "zen.workspace.zentral.boost.widget_enabled";
const TOAST_MS = 4000;
const markerState = { mode: "pending", disposed: false };
const cardInstances = new Set();
let disposed = false;
let decisionTimer = null;
let hostUnregister = null;
let ownCardCleanup = null;
let trayUnregister = null;
let hover = null;
let anchor = null;

const consoleWarn = (...args) => {
  try { window.console?.warn?.("[Zentral Boost standalone widget]", ...args); } catch (_) {}
};
const boostApi = () => window.ZentralBoost || null;
const enabled = () =>
  runtime.getPref(BOOST_ENABLED, true) !== false &&
  runtime.getPref(WIDGET_ENABLED, true) !== false;
const language = () => {
  const raw = window.navigator?.language || window.navigator?.userLanguage || "en";
  const api = boostApi();
  return typeof api?.widgetLanguage === "function" ? api.widgetLanguage(raw) : String(raw).toLowerCase().startsWith("pl") ? "pl" : "en";
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

function menuItems(api, snapshot, previewLine = "") {
  const lang = language();
  const state = typeof api?.state === "function" ? api.state() : {};
  const game = typeof api?.gameModeState === "function" ? api.gameModeState() : { on: false };
  const options = {
    previewHint: previewLine,
    running: Boolean(state.level2Busy),
    canDeep: state.policy !== false,
    canGameMode: typeof api?.setGameMode === "function",
    canRestore: typeof api?.restoreSession === "function" || typeof api?.restore === "function",
    gameMode: game,
    snapshot,
    language: lang,
    undoSize: number(state.undoSize, 0),
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
  let wantsActive = false;
  let subscribed = false;
  let sampling = false;
  let samplingApi = null;
  let unsubChange = null;
  let unsubGameModeEvents = null;
  let gameModeEventCount = 0;
  let cardDisposed = false;

  const ownListen = (target, type, fn, options, bucket = cardReleases) => {
    if (!target || typeof target.addEventListener !== "function") return () => {};
    const release = lifecycle.listen(target, type, fn, options);
    bucket.push(release);
    return release;
  };
  const clearActions = () => {
    for (const release of actionReleases.splice(0).reverse()) {
      try { release(); } catch (_) {}
    }
    while (root.querySelector?.("[data-zw-boost-action]")) {
      const node = root.querySelector("[data-zw-boost-action]");
      node.remove();
    }
    const popup = root.querySelector?.(".zbsw-popup");
    if (popup) while (popup.children?.length) popup.children[0].remove();
  };
  const clearToast = () => {
    if (toastTimer !== null) {
      lifecycle.clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (actionToastRelease) {
      try { actionToastRelease(); } catch (_) {}
      actionToastRelease = null;
    }
    const toast = root.querySelector?.(".zbsw-toast");
    if (toast) {
      while (toast.children?.length) toast.children[0].remove();
      toast.textContent = "";
      toast.hidden = true;
    }
  };

  root.setAttribute("class", "zbsw-card" + (mode === "tray" ? " zbsw-tray-card" : ""));
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", text("card.title"));
  const row = doc.createElement("div");
  row.className = "zbsw-row";
  const valueEl = doc.createElement("span");
  valueEl.className = "zbsw-value";
  valueEl.textContent = "\u2014";
  const labelEl = doc.createElement("span");
  labelEl.className = "zbsw-label";
  labelEl.textContent = text("card.title");
  const popup = doc.createElement("div");
  popup.className = "zbsw-popup";
  popup.setAttribute("role", "group");
  popup.setAttribute("aria-label", "Boost levels and Restore");
  popup.hidden = false;
  row.appendChild(valueEl);
  row.appendChild(labelEl);
  row.appendChild(popup);
  root.appendChild(row);
  const hintEl = doc.createElement("div");
  hintEl.className = "zbsw-hint";
  hintEl.hidden = true;
  root.appendChild(hintEl);
  const toastEl = doc.createElement("div");
  toastEl.className = "zbsw-toast";
  toastEl.setAttribute("role", "status");
  toastEl.hidden = true;
  root.appendChild(toastEl);

  function paintValue() {
    const api = boostApi();
    let mb = null;
    try { mb = typeof api?.lastMB === "function" ? api.lastMB() : null; } catch (_) {}
    if (!Number.isFinite(Number(mb)) || Number(mb) <= 0) {
      try { mb = typeof api?.memoryMB === "function" ? api.memoryMB() : null; } catch (_) {}
    }
    const value = Number(mb);
    valueEl.textContent = Number.isFinite(value) && value > 0
      ? text("card.ram", { mb: Math.round(value) })
      : "\u2014";
    root.setAttribute("data-zw-boost", Number.isFinite(value) && value > 0 ? String(Math.round(value)) : "");
    root.setAttribute("aria-label", Number.isFinite(value) && value > 0
      ? text("card.ram", { mb: Math.round(value) }) + " \u00b7 " + text("card.title")
      : text("card.unknown"));
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

  function previewHint() {
    const line = computePreviewLine();
    if (!line) return;
    hintEl.textContent = line;
    hintEl.setAttribute("data-zw-boost-preview", line);
    hintEl.hidden = false;
  }

  function paintMenu() {
    clearActions();
    const api = boostApi();
    const snapshot = snapshotOf(api);
    const items = menuItems(api, snapshot, computePreviewLine());
    for (const item of items) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "zbsw-action";
      button.setAttribute("data-zw-boost-action", item.id);
      if (item.level) button.setAttribute("data-zw-boost-level", item.level);
      button.textContent = item.shortLabel || item.label || item.id;
      button.setAttribute("aria-label", item.label || item.shortLabel || item.id);
      const hints = [item.description, item.hint].filter(Boolean).join(" \u00b7 ");
      if (hints) button.setAttribute("title", hints);
      if (item.checked !== undefined) {
        button.setAttribute("role", "switch");
        button.setAttribute("aria-checked", item.checked ? "true" : "false");
      }
      button.disabled = item.available === false;
      if (button.disabled) button.setAttribute("aria-disabled", "true");
      if (item.available !== false) {
        ownListen(button, "click", (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          void runAction(item.id);
        }, undefined, actionReleases);
        if (item.id === "game-mode") {
          ownListen(button, "mouseenter", previewHint, undefined, actionReleases);
          ownListen(button, "focus", previewHint, undefined, actionReleases);
        }
      }
      popup.appendChild(button);
    }
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
    toastEl.textContent = String(message || "");
    toastEl.hidden = false;
    if (action && typeof action.run === "function") {
      toastEl.textContent = "";
      const line = doc.createElement("span");
      line.className = "zbsw-toast-line";
      line.textContent = String(message || "");
      toastEl.appendChild(line);
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "zbsw-toast-action";
      button.textContent = action.label || text("card.restore");
      actionToastRelease = ownListen(button, "click", (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        action.run();
      });
      toastEl.appendChild(button);
    }
    toastTimer = lifecycle.setTimeout(() => {
      toastTimer = null;
      clearToast();
    }, TOAST_MS);
  }

  async function runAction(id) {
    const api = boostApi();
    if (!api) return null;
    if (id === "free-light" && typeof api.runLevel1 === "function") {
      showToast(text("card.busy"));
      let result = null;
      try { result = await api.runLevel1(); } catch (_) { result = null; }
      showToast(typeof api.widgetResultText === "function"
        ? api.widgetResultText(result, language())
        : text("card.result", { mb: number(result?.freedMB, 0) }));
      paintValue();
      paintMenu();
      return result;
    }
    if (id === "free-deep" && typeof api.runLevel2 === "function") {
      showToast(text("card.busy"));
      let result = null;
      try { result = await api.runLevel2(); } catch (_) { result = null; }
      showToast(typeof api.widgetResultText === "function"
        ? api.widgetResultText(result, language())
        : text("card.result", { mb: number(result?.freedMB, 0) }));
      paintValue();
      paintMenu();
      return result;
    }
    if (id === "game-mode" && typeof api.setGameMode === "function") {
      previewHint();
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
      const before = snapshotOf(api);
      let result = null;
      try {
        result = typeof api.restoreSession === "function" ? api.restoreSession() : api.restore?.();
      } catch (_) { result = null; }
      showToast(text("card.restoreDone", {
        panels: number(before.panels, 0),
        tabs: number(before.tabs, 0),
      }));
      paintMenu();
      return result;
    }
    return null;
  }

  function start() {
    if (cardDisposed) return;
    wantsActive = true;
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
    subscribeGameModeEvents();
  }
  function stop() {
    wantsActive = false;
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
    hintEl.hidden = true;
    clearToast();
  });
  refresh();
  return instance;
}

function trayDefinition() {
  return {
    id: "boost",
    title: text("card.title"),
    showHeader: false,
    order: 50,
    pref: WIDGET_ENABLED,
    defaultEnabled: true,
    refreshMs: 0,
    create(args = {}) {
      const cardDoc = args.document || doc;
      const root = cardDoc.createElement("div");
      const instance = createCard({ root, mode: "tray" });
      const release = lifecycle.own(() => {
        instance.dispose();
        root.remove();
      });
      return { ...instance, dispose() { release(); } };
    },
  };
}

function registerWithTray(handoff) {
  const register = typeof handoff === "function" ? handoff : handoff?.registerWidget;
  if (typeof register !== "function") return false;
  destroyOwnCard();
  try {
    register(trayDefinition());
    markerState.mode = "tray";
    const unregister = typeof handoff === "function" ? null : handoff.unregisterWidget;
    trayUnregister = typeof unregister === "function" ? () => unregister("boost") : null;
    return true;
  } catch (error) {
    consoleWarn("tray registration failed", error);
    return false;
  }
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
  if (ownCardCleanup || markerState.mode === "tray") return;
  if (!doc || typeof doc.createElement !== "function" || typeof doc.documentElement?.append !== "function") return;
  let card = null;
  const localAnchor = doc.createElement("button");
  localAnchor.type = "button";
  localAnchor.id = ANCHOR_ID;
  localAnchor.className = "zbsw-anchor";
  localAnchor.setAttribute("aria-label", text("card.title"));
  localAnchor.textContent = text("card.title");
  const rect = runtime.nativeSidebarRect();
  localAnchor.style.left = Math.max(4, number(rect.left, 4)) + "px";
  localAnchor.style.top = Math.max(4, number(rect.top, 4)) + "px";
  doc.documentElement.appendChild(localAnchor);

  const localHover = runtime.createSidebarHoverCard({
    window,
    document: doc,
    id: CARD_ID,
    className: "zentral-boost-standalone-card",
    role: "group",
    ariaLabel: text("card.title"),
    defaultWidth: 300,
    defaultHeight: 26,
    getShowDelay: () => 0,
    getHideDelay: () => 0,
    getGap: () => 6,
    getSide: () => "auto",
    getBounds: () => {
      const r = runtime.nativeSidebarRect();
      return { left: number(r.left, 0), right: number(r.right, window.innerWidth || 1200) };
    },
    isEnabled: () => !disposed && enabled(),
    isValid: (target) => Boolean(target && target.isConnected !== false),
    setTimer: (fn, ms) => lifecycle.setTimeout(fn, ms),
    clearTimer: (id) => lifecycle.clearTimeout(id),
    onCreate(node) {
      card = createCard({ root: node, mode: "self" });
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
  const releaseHover = lifecycle.own(() => {
    try { localHover.destroy(); } catch (_) {}
  });
  const releaseAnchor = lifecycle.own(() => {
    try { localAnchor.remove(); } catch (_) {}
  });
  const releaseCard = lifecycle.own(() => {
    try { card?.dispose(); } catch (_) {}
    card = null;
  });
  ownListenSelf(localAnchor, "mouseenter", () => localHover.show(localAnchor));
  ownListenSelf(localAnchor, "focus", () => localHover.show(localAnchor));
  ownListenSelf(window, "resize", () => localHover.position());
  ownCardCleanup = lifecycle.own(() => {
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
    markerState.mode = "self";
  } catch (error) {
    consoleWarn("self-contained card failed", error);
    destroyOwnCard();
  }
}

function ownListenSelf(target, type, fn, options) {
  if (!target || typeof target.addEventListener !== "function") return;
  lifecycle.listen(target, type, fn, options);
}

function decideOwner() {
  decisionTimer = null;
  if (disposed || !lifecycle.active || markerState.mode === "tray") return;
  if (!enabled()) {
    markerState.mode = "hidden";
    return;
  }
  const tray = window.ZentralWidgets;
  const hasBuiltInBoost = typeof tray?.listWidgets === "function" &&
    tray.listWidgets().some((row) => row && row.id === "boost");
  if (hasBuiltInBoost) {
    markerState.mode = "tray";
    return;
  }
  if (tray && typeof tray.registerWidget === "function") {
    if (registerWithTray({
      registerWidget: tray.registerWidget,
      unregisterWidget: tray.unregisterWidget,
    })) return;
  }
  createSelfCard();
}

const previous = window[MARKER];
try { previous?.destroy?.(); } catch (_) {}
const marker = {
  id: "boost",
  version: 1,
  get mode() { return markerState.mode; },
  visible: enabled,
  refresh() {
    for (const instance of [...cardInstances]) {
      try { instance.refresh(); } catch (error) { consoleWarn("refresh failed", error); }
    }
  },
  takeOver(handoff) {
    if (disposed || markerState.mode === "tray") return false;
    return registerWithTray(handoff);
  },
  destroy: fullCleanup,
};
window[MARKER] = marker;

function fullCleanup() {
  if (disposed) return;
  disposed = true;
  markerState.disposed = true;
  if (decisionTimer !== null) {
    lifecycle.clearTimeout(decisionTimer);
    decisionTimer = null;
  }
  destroyOwnCard();
  for (const instance of [...cardInstances]) {
    try { instance.dispose(); } catch (_) {}
  }
  cardInstances.clear();
  if (trayUnregister) {
    try { trayUnregister(); } catch (_) {}
    trayUnregister = null;
  }
  if (hostUnregister) {
    try { hostUnregister(); } catch (_) {}
    hostUnregister = null;
  }
  if (window[MARKER] === marker) delete window[MARKER];
}

hostUnregister = runtime.registerHostUnload(fullCleanup);
decisionTimer = lifecycle.setTimeout(() => {
  decideOwner();
  // One post-native-ready refresh lets a tray card created before window.ZentralBoost
  // bind the API without polling or a second registration.
  marker.refresh();
}, 0);
return fullCleanup;
