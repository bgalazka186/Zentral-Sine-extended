/*
 * ZENTRAL FILE GUIDE - features/tabs/dragging/ZentralTabDrag.uc.js
 *
 * Purpose: Sort native tabs without selecting or waking their browsers.
 * Registration: tab-drag; independent of Apps, Panels and Tab Groups.
 * Native integration: Preserve native mousedown bookkeeping and drag payloads;
 * suppress selection only during initial press, drag setup and same-window move
 * drops. Skip PageThumbs captures of sleeping tabs during native drag setup.
 * Intentional clicks, split creation, link drops, copies and detachment retain
 * native behavior. Existing split groups use Zen's native group drag handling.
 * Ownership: Live preference; exact descriptor restoration at teardown. Wrappers
 * retained by another mod become inert. No source rewriting or tab re-unloading.
 */
(function () {
  "use strict";
  const Services = globalThis.Services || ChromeUtils.importESModule(
    "resource://gre/modules/Services.sys.mjs",
  ).Services;
  const PREF = "zen.workspace.zentral.tabs.background_drag";

  function start() {
    if (window.ZentralTabDrag) return window.ZentralTabDrag.destroy;
    const browser = window.gBrowser;
    const strip = browser?.tabContainer;
    const dnd = strip?.tabDragAndDrop;
    if (!strip || typeof dnd?.startTabDrag !== "function")
      throw new Error("Background tab dragging requires native tab drag-and-drop");
    const thumbs = window.PageThumbs || ChromeUtils.importESModule(
      "resource://gre/modules/PageThumbs.sys.mjs",
    ).PageThumbs;
    let active = true, gesture = null, mouseScope = false, moveScope = false;
    let dragDepth = 0, dragItem = null, dropCleanupTimer = null;
    const cleanups = [];
    const enabled = () => active && Services.prefs.getBoolPref(PREF, true);
    const isTab = (node) => browser.isTab(node);
    const groupOf = (node) => node?.group || node?.closest?.("tab-group");
    function tabsOf(node) {
      if (isTab(node)) return [node];
      return Array.from((node?.tabs || groupOf(node)?.tabs) || []);
    }
    function resolvePressTab(target) {
      const tab = target?.closest?.("tab, tabbrowser-tab, .tabbrowser-tab");
      if (tab && isTab(tab)) return tab;
      const group = target?.closest?.("tab-group[split-view-group]");
      return group?.tabs?.[0] || null;
    }
    function sleeping(tab) {
      return tab && (tab.hasAttribute("pending") || tab.hasAttribute("discarded") ||
        !tab.linkedPanel);
    }
    function protectedItem(item) {
      const source = dragDepth ? dragItem : gesture?.tab;
      if (!source) return false;
      if (item === source) return true;
      const sourceGroup = groupOf(source);
      if (sourceGroup && (item === sourceGroup || groupOf(item) === sourceGroup) &&
          sourceGroup.hasAttribute("split-view-group")) return true;
      return source.multiselected
        ? browser.selectedTabs.includes(item)
        : !isTab(source) && tabsOf(source).includes(item);
    }
    function blockSelection(item) {
      return enabled() && (mouseScope || moveScope || dragDepth > 0) &&
        item !== browser.selectedTab && protectedItem(item);
    }
    function descriptor(object, key) {
      for (let node = object; node; node = Object.getPrototypeOf(node)) {
        const desc = Object.getOwnPropertyDescriptor(node, key);
        if (desc) return desc;
      }
      throw new Error("Missing native property: " + key);
    }
    function replace(object, key, next) {
      const own = Object.getOwnPropertyDescriptor(object, key);
      if (own && !own.configurable) throw new Error("Native property is not configurable: " + key);
      Object.defineProperty(object, key, next);
      cleanups.push(() => {
        const current = Object.getOwnPropertyDescriptor(object, key);
        if (current?.value !== next.value || current?.get !== next.get || current?.set !== next.set)
          return;
        if (own) Object.defineProperty(object, key, own);
        else delete object[key];
      });
    }
    function wrapMethod(object, key, create) {
      const original = object[key];
      if (typeof original !== "function") throw new Error("Missing native method: " + key);
      replace(object, key, { configurable: true, writable: true,
        enumerable: descriptor(object, key).enumerable, value: create(original) });
    }
    function wrapSelection(object, key) {
      const original = descriptor(object, key);
      if (!original.get || !original.set) throw new Error("Missing native selection accessor: " + key);
      replace(object, key, { configurable: true, enumerable: original.enumerable,
        get() { return original.get.call(this); },
        set(value) { if (!blockSelection(value)) original.set.call(this, value); },
      });
    }
    function listen(target, type, callback) {
      target.addEventListener(type, callback, true);
      cleanups.push(() => target.removeEventListener(type, callback, true));
    }
    function clearGesture() {
      if (dropCleanupTimer !== null) window.clearTimeout(dropCleanupTimer);
      dropCleanupTimer = null;
      gesture = null;
      mouseScope = moveScope = false;
    }
    function onMouseDown(event) {
      clearGesture();
      if (!enabled() || event.button !== 0 || event.shiftKey || event.ctrlKey ||
          event.metaKey || event.altKey || !strip.contains(event.target) ||
          event.target.closest?.(
            ".tab-close-button, .tab-icon-overlay, .tab-audio-button, .tab-reset-button, .tab-reset-pin-button, .tab-note-icon-overlay, toolbarbutton, button",
          )) return;
      const tab = resolvePressTab(event.target);
      if (!tab || tab === browser.selectedTab || tab.hasAttribute("zen-glance-tab")) return;
      gesture = { tab, dragging: false };
      // Let native handlers maintain focus, metrics and multiselection. Only
      // defer their selection until we know whether this press becomes a drag.
      // Microtasks can run between listeners of a real user-input event.
      // Keep this target-specific guard until mouseup or native drag setup;
      // unrelated tab selection stays available throughout the gesture.
      mouseScope = true;
    }
    function onMouseUp(event) {
      if (event.button !== 0) return;
      const press = gesture;
      if (press?.dragging) return;
      clearGesture();
      if (enabled() && press && !press.dragging && press.tab.isConnected &&
          resolvePressTab(event.target) === press.tab)
        browser.selectedTab = press.tab;
    }
    function onDrop(event) {
      if (!enabled() || !gesture?.dragging || event.dataTransfer?.dropEffect !== "move") return;
      const workspaceIcons = window.gZenWorkspaces?.workspaceIcons;
      if (!strip.contains(event.target) && !workspaceIcons?.contains(event.target)) return;
      // Native workspace moves select the dragged tab explicitly. Suppress
      // that selection only for sorting; web-content/split drops remain native.
      moveScope = true;
      const dropping = gesture;
      if (dropCleanupTimer !== null) window.clearTimeout(dropCleanupTimer);
      // A task boundary, rather than a microtask, lets every native drop
      // listener finish first (including Zen's explicit workspace selection).
      dropCleanupTimer = window.setTimeout(() => {
        dropCleanupTimer = null;
        if (gesture === dropping) clearGesture();
      }, 0);
    }
    function destroy() {
      if (!active) return;
      active = false;
      clearGesture();
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      if (window.ZentralTabDrag?.destroy === destroy) delete window.ZentralTabDrag;
    }
    try {
      wrapSelection(browser, "selectedTab");
      wrapSelection(strip, "selectedItem");
      wrapMethod(browser, "setSelectedTab", (original) => function (tab, ...args) {
        if (!blockSelection(tab)) return original.call(this, tab, ...args);
        return undefined;
      });
      const selectedTabs = descriptor(browser, "selectedTabs");
      replace(browser, "selectedTabs", { configurable: true, enumerable: selectedTabs.enumerable,
        get() {
          const tabs = selectedTabs.get.call(this);
          // Native selectedTabs always includes the active tab. During a drag
          // of a multiselection, include it only if explicitly multiselected.
          if (enabled() && dragDepth && isTab(dragItem) && dragItem.multiselected)
            return tabs.filter((tab) => tab === dragItem || tab.multiselected);
          return tabs;
        },
      });
      const elements = descriptor(browser, "selectedElements");
      replace(browser, "selectedElements", { configurable: true, enumerable: elements.enumerable,
        get() {
          // Native startTabDrag normally selects the source before collecting
          // the payload. Preserve the actual source without dragging the active
          // tab along; keep existing multiselections and group-label semantics.
          if (enabled() && dragDepth && isTab(dragItem) && !dragItem.multiselected)
            return [dragItem];
          return elements.get.call(this);
        },
      });
      wrapMethod(thumbs, "captureToCanvas", (original) => function (sourceBrowser, ...args) {
        if (enabled() && dragDepth) {
          const tab = browser.getTabForBrowser(sourceBrowser);
          if (sleeping(tab)) return Promise.resolve();
        }
        return original.call(this, sourceBrowser, ...args);
      });
      wrapMethod(dnd, "startTabDrag", (original) => function (event, item, ...args) {
        if (!enabled()) return original.call(this, event, item, ...args);
        const previous = dragItem;
        dragItem = item;
        gesture = { tab: item, dragging: true };
        mouseScope = false;
        dragDepth++;
        try { return original.call(this, event, item, ...args); }
        finally { dragDepth--; dragItem = previous; }
      });
      listen(window, "mousedown", onMouseDown);
      listen(window, "mouseup", onMouseUp);
      listen(window, "drop", onDrop);
      listen(window, "dragend", clearGesture);
      listen(window, "blur", clearGesture);
      listen(window, "unload", destroy);
      Services.prefs.addObserver(PREF, clearGesture);
      cleanups.push(() => Services.prefs.removeObserver(PREF, clearGesture));
      window.ZentralTabDrag = { destroy };
      return destroy;
    } catch (error) {
      destroy();
      throw error;
    }
  }
  if (window.ZentralRuntime) {
    window.ZentralRuntime.register({ id: "tab-drag", init: start });
  } else if (window.gBrowserInit?.delayedStartupFinished) {
    start();
  } else {
    const observer = { observe(subject) {
      if (subject !== window) return;
      Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
      window.removeEventListener("unload", cancel);
      start();
    } };
    const cancel = () => Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
    window.addEventListener("unload", cancel, { once: true });
  }
})();
