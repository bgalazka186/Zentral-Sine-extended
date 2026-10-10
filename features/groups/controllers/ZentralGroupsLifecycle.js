/* Owns work installed during one Tab Groups enable cycle. */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("groups/ZentralGroupsLifecycle", function () {
    let active = false;
    let generation = 0;
    const timers = new Map();
    const frames = new Set();
    const observers = new Set();
    const listeners = [];
    const cleanups = [];
    const presentations = new Map();
    const detached = new Map();
    const menus = new Map();
    const menuStyles = new Map();
    const api = {
      get active() { return active; },
      get generation() { return generation; },
      isCurrent(token) { return active && token === generation; },
      begin() { active = true; generation++; },
      cleanup(fn) { cleanups.push(fn); },
      override(object, name, callback) {
        const own = Object.getOwnPropertyDescriptor(object, name);
        const original = object[name];
        const token = generation;
        const wrapped = function (...args) {
          if (api.isCurrent(token)) return callback.apply(this, args);
          if (typeof original === "function") return original.apply(this, args);
        };
        object[name] = wrapped;
        api.cleanup(() => {
          if (object[name] !== wrapped) return;
          if (own) Object.defineProperty(object, name, own);
          else delete object[name];
        });
      },
      captureMenu(popup) {
        if (!menus.has(popup)) menus.set(popup, [...popup.children]);
        for (const node of popup.querySelectorAll("*")) {
          if (!menuStyles.has(node)) menuStyles.set(node, node.getAttribute("style"));
        }
      },
      setTimeout(callback, delay, ...args) {
        if (!active) return null;
        const token = generation;
        const id = window.setTimeout(() => {
          timers.delete(id);
          if (api.isCurrent(token)) callback(...args);
        }, delay);
        timers.set(id, null);
        return id;
      },
      clearTimeout(id) {
        window.clearTimeout(id);
        const cancel = timers.get(id);
        timers.delete(id);
        cancel?.();
      },
      sleep(delay) {
        return new Promise((resolve) => {
          if (!active) return resolve(false);
          const id = api.setTimeout(() => resolve(true), delay);
          timers.set(id, () => resolve(false));
        });
      },
      requestAnimationFrame(callback) {
        if (!active) return null;
        const token = generation;
        const id = window.requestAnimationFrame((time) => {
          frames.delete(id);
          if (api.isCurrent(token)) callback(time);
        });
        frames.add(id);
        return id;
      },
      cancelAnimationFrame(id) {
        window.cancelAnimationFrame(id);
        frames.delete(id);
      },
      listen(target, type, listener, options) {
        if (!active || !target) return;
        target.addEventListener(type, listener, options);
        listeners.push([target, type, listener, options]);
      },
      MutationObserver: function (callback) {
        const token = generation;
        const observer = new window.MutationObserver((...args) => {
          if (api.isCurrent(token)) callback(...args);
        });
        observers.add(observer);
        return observer;
      },
      // Keep native elements and their listeners; never clone native chrome.
      detach(node) {
        if (!node?.parentNode || detached.has(node)) return;
        const marker = document.createComment("Zentral group header");
        node.before(marker);
        detached.set(node, marker);
        node.remove();
      },
      capturePresentation(group) {
        if (!group || presentations.has(group)) return;
        const header = group.querySelector(".tab-group-label-container");
        const nodes = header ? [header, ...header.querySelectorAll("*")] : [];
        const records = nodes.map((node) => ({
          node,
          children: [...node.childNodes],
          style: node.getAttribute("style"),
          hidden: node.getAttribute("hidden"),
          context: node.getAttribute("context"),
        }));
        const attributes = ["zentral-group", "data-close-button-added", "data-has-subgroups", "context"];
        presentations.set(group, {
          header, records,
          attributes: attributes.map((name) => [name, group.getAttribute(name)]),
          standard: group.classList.contains("zentral-standard"),
          radius: group.style.getPropertyValue("border-radius"),
          radiusPriority: group.style.getPropertyPriority("border-radius"),
        });
      },
      stop() {
        active = false;
        generation++;
        for (const [id, cancel] of timers) {
          window.clearTimeout(id);
          cancel?.();
        }
        timers.clear();
        for (const id of frames) window.cancelAnimationFrame(id);
        frames.clear();
        for (const observer of observers) observer.disconnect();
        observers.clear();
        for (const [target, type, listener, options] of listeners.splice(0))
          target.removeEventListener(type, listener, options);
        for (const cleanup of cleanups.splice(0).reverse()) {
          try { cleanup(); } catch (error) { console.warn("[ZentralTabGroups] Cleanup", error); }
        }
        for (const [node, marker] of detached) {
          if (marker.parentNode) marker.replaceWith(node);
        }
        detached.clear();
        const restoreAttribute = (node, name, value) => {
          if (value === null) node.removeAttribute(name);
          else node.setAttribute(name, value);
        };
        for (const [node, style] of menuStyles) restoreAttribute(node, "style", style);
        menuStyles.clear();
        for (const [popup, children] of menus) {
          // Native builders may have replaced these items while the menu was open.
          // Restore existing items only; never resurrect a stale native menu item.
          for (const node of children) {
            if (node.parentNode === popup) popup.appendChild(node);
          }
        }
        menus.clear();
        for (const [group, saved] of presentations) {
          // Preserve group/tab membership, current names, colors and collapse state.
          // Only undo the presentation and header structure owned by this feature.
          if (saved.header) {
            for (const {node, children, style, hidden, context} of saved.records) {
              node.replaceChildren(...children);
              restoreAttribute(node, "style", style);
              restoreAttribute(node, "hidden", hidden);
              restoreAttribute(node, "context", context);
              node.removeAttribute("zentral-hover");
              delete node._zentralToggleBound;
              delete node._zentralContextMenuBound;
            }
            const label = saved.header.querySelector(".tab-group-label");
            if (label) {
              label.textContent = group.label || group.getAttribute("label") || label.textContent;
              label.classList.remove("tab-group-label-editing");
            }
          } else {
            group.querySelector(".tab-group-label-container")?.remove();
          }
          for (const [name, value] of saved.attributes) restoreAttribute(group, name, value);
          group.classList.toggle("zentral-standard", saved.standard);
          if (saved.radius) group.style.setProperty("border-radius", saved.radius, saved.radiusPriority);
          else group.style.removeProperty("border-radius");
          group.shadowRoot?.querySelectorAll(".zentral-shadow-style").forEach((node) => node.remove());
          delete group._zentralColoringInProgress;
          delete group._zentralInitialColorChecked;
          delete group._zentralContextMenuBound;
        }
        presentations.clear();
      },
    };
    return api;
  });
})();
