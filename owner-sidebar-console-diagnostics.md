# Owner sidebar console diagnostic — 1 or 2 commands

This is read-only: it does **not** change the DOM, prefs, CSS or Zentral code. Run it in the **Browser Console / chrome context**, not a webpage console.

## Command 1 — optional label

Skip this if you only need one command. The main script auto-labels the run `expanded` or `collapsed-or-unset` from `zen-sidebar-expanded`. Use this only when you want a custom label, e.g. one run collapsed and one expanded:

```js
window.__zentralSidebarDiagLabel = "collapsed-broken";
```

For the second run, either change that string to `"expanded"` or just let the auto-label do it.

## Command 2 — run diagnostic and copy JSON to clipboard

Paste this whole block. It logs the JSON between `ZENTRAL_SIDEBAR_DIAG_JSON_START` / `..._END`, prints a short table, and **copies the JSON to the clipboard at the end**. A successful run prints `CLIPBOARD_OK: ... — JSON is on the clipboard`.

```js
(async () => {
  "use strict";
  /* READ-ONLY Zentral Notes/Agenda sidebar diagnostic. ONE command.
     Run in the Browser Console with the browser chrome document selected.
     At the end it copies the JSON result to the clipboard. */
  const W = window;
  const doc = document;
  const root = doc.documentElement;
  const autoState = root.getAttribute("zen-sidebar-expanded") === "true" ? "expanded" : "collapsed-or-unset";
  const LABEL = W.__zentralSidebarDiagLabel || autoState;
  const ServicesNS = W.Services || (W.ChromeUtils
    ? W.ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services
    : null);

  const clip = async (text) => {
    // DevTools helper first, then the async web API, then Firefox's privileged clipboard helper.
    try { if (typeof copy === "function") { copy(text); return "devtools copy()"; } } catch (_) {}
    try {
      if (W.navigator?.clipboard?.writeText) {
        await W.navigator.clipboard.writeText(text);
        return "navigator.clipboard";
      }
    } catch (_) {}
    try {
      const Cc = globalThis.Components?.classes || globalThis.Cc;
      const Ci = globalThis.Components?.interfaces || globalThis.Ci;
      if (Cc && Ci) {
        Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
        return "nsIClipboardHelper";
      }
    } catch (e) { return "FAILED: " + String(e?.message || e); }
    return "FAILED: no clipboard method available";
  };

  try {
  if (!doc.querySelector("tab.tabbrowser-tab")) {
    console.warn("WRONG_DOCUMENT: this is not the browser chrome document; results may be empty.");
  }

  const PROPS = [
    "display","visibility","opacity","filter","mix-blend-mode","isolation",
    "color","fill","background-color","font-size","line-height","text-align",
    "text-overflow","white-space","overflow","overflow-x","overflow-y","clip","clip-path",
    "contain","position","left","top","right","bottom","transform","scale","translate",
    "width","min-width","max-width","height","min-height","max-height",
    "flex","flex-basis","flex-grow","flex-shrink","order","-moz-box-flex",
    "-moz-box-ordinal-group","align-items","align-self","justify-content","justify-self",
    "margin","margin-inline","margin-inline-start","margin-inline-end","margin-block",
    "padding","padding-inline","padding-inline-start","padding-inline-end","padding-block",
    "box-sizing","pointer-events","appearance","-moz-appearance",
  ];
  const ATTRS = [
    "id","class","label","value","image","src","title","tooltiptext","style",
    "pending","discarded","pinned","selected","zen-essential","zen-pinned-changed",
    "collapsed","labeldirection","fadein","context","aria-hidden",
    "bgalazka-notes-item","bgalazka-notes-agenda-item","bgalazka-notes-label",
    "bgalazka-notes-color","bgalazka-notes-agenda-kind","bgalazka-notes-agenda-day",
    "bgalazka-notes-folder","bgalazka-notes-subfolder","bgalazka-notes-agenda-folder",
    "bgalazka-tabbar-compact","bgalazka-density-icons","bgalazka-corner-tiles",
    "bgalazka-tab-panel-launcher","zen-sidebar-expanded",
  ];
  const RELEVANT = new RegExp(PROPS.map((p) => p.replace(/[-]/g, "\\-")).join("|"), "i");

  const n = (v) => typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  const attrs = (el) => {
    const out = {};
    for (const a of ATTRS) {
      try { const v = el?.getAttribute?.(a); if (v !== null && v !== undefined && v !== "") out[a] = String(v).slice(0, 300); } catch (_) {}
    }
    return out;
  };
  const info = (el) => {
    if (!el || !el.nodeType) return null;
    let cs = null, r = null;
    try { cs = getComputedStyle(el); } catch (_) {}
    try { r = el.getBoundingClientRect(); } catch (_) {}
    const computed = {};
    for (const p of PROPS) {
      try { computed[p] = cs ? cs.getPropertyValue(p) : null; } catch (_) { computed[p] = "ERR"; }
    }
    return {
      tag: el.localName || el.nodeName,
      namespace: el.namespaceURI || null,
      attrs: attrs(el),
      text: String(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200),
      rect: r ? { x: n(r.x), y: n(r.y), width: n(r.width), height: n(r.height) } : null,
      box: {
        clientWidth: el.clientWidth ?? null, clientHeight: el.clientHeight ?? null,
        offsetWidth: el.offsetWidth ?? null, offsetHeight: el.offsetHeight ?? null,
        scrollWidth: el.scrollWidth ?? null, scrollHeight: el.scrollHeight ?? null,
      },
      inlineStyle: (() => { try { return el.getAttribute("style"); } catch (_) { return null; } })(),
      computed,
    };
  };
  const sheetInfo = (sheet, index) => {
    let owner = null, ruleCount = null;
    try { owner = sheet.ownerNode; } catch (_) {}
    try { ruleCount = sheet.cssRules ? sheet.cssRules.length : null; } catch (_) {}
    return {
      index,
      href: sheet.href || null,
      title: sheet.title || null,
      disabled: !!sheet.disabled,
      ruleCount,
      owner: owner ? {
        tag: owner.localName || owner.nodeName,
        id: owner.id || null,
        class: String(owner.getAttribute?.("class") || "").slice(0, 160),
        title: owner.getAttribute?.("title") || null,
        outerStart: String(owner.outerHTML || "").slice(0, 180),
      } : null,
    };
  };
  const ruleDecls = (rule) => {
    const out = {};
    try {
      for (let i = 0; i < rule.style.length; i++) {
        const p = rule.style.item(i);
        out[p] = {
          value: rule.style.getPropertyValue(p),
          priority: rule.style.getPropertyPriority(p) || "",
        };
      }
    } catch (_) {}
    return out;
  };
  const sourceOf = (rule, sheet) => ({
    href: rule.parentStyleSheet?.href || sheet?.href || null,
    title: rule.parentStyleSheet?.title || sheet?.title || null,
    owner: rule.parentStyleSheet?.ownerNode?.id || sheet?.ownerNode?.id || null,
  });
  const matchedRules = (el, limit = 120) => {
    if (!el) return [];
    const out = [];
    const push = (rule, sheet, sheetIndex, ruleIndex, media, layer, origin) => {
      try {
        if (!rule || !rule.selectorText) return;
        let hit = false;
        try { hit = el.matches(rule.selectorText); } catch (_) { return; }
        if (!hit) return;
        const decls = ruleDecls(rule);
        if (!Object.keys(decls).some((p) => RELEVANT.test(p))) return;
        out.push({
          origin, sheetIndex, ruleIndex,
          selector: rule.selectorText,
          media: media.slice(), layer: layer.slice(),
          source: sourceOf(rule, sheet),
          cssText: String(rule.style?.cssText || "").slice(0, 900),
          decls,
        });
      } catch (_) {}
    };
    const walk = (rules, sheet, sheetIndex, media, layer, origin) => {
      let list;
      try { list = rules; } catch (_) { return; }
      for (let i = 0; i < (list?.length || 0); i++) {
        const rule = list[i];
        push(rule, sheet, sheetIndex, i, media, layer, origin);
        try {
          if (rule.cssRules) walk(rule.cssRules, sheet, sheetIndex,
            media.concat(rule.conditionText ? [String(rule.conditionText)] : []),
            layer.concat(rule.name ? [String(rule.name)] : []), origin);
        } catch (_) {}
        try {
          if (rule.styleSheet && rule.styleSheet !== sheet) {
            walk(rule.styleSheet.cssRules, rule.styleSheet, sheetIndex,
              media.concat(["@import " + (rule.href || "")]),
              layer.concat(rule.layer ? [String(rule.layer)] : []), origin + ":import");
          }
        } catch (_) {}
      }
    };
    for (let s = 0; s < doc.styleSheets.length; s++) {
      const sheet = doc.styleSheets[s];
      try { walk(sheet.cssRules, sheet, s, [], [], "document.styleSheets"); }
      catch (e) { out.push({ origin: "document.styleSheets:error", sheetIndex: s, error: String(e) }); }
    }
    // Privileged InspectorUtils can also expose UA / author rules missing from document.styleSheets.
    let iu = W.InspectorUtils;
    if (!iu && W.ChromeUtils) {
      try { iu = ChromeUtils.importESModule("resource://gre/modules/InspectorUtils.sys.mjs").InspectorUtils; } catch (_) {}
    }
    if (iu && typeof iu.getCSSStyleRules === "function") {
      try {
        const rules = iu.getCSSStyleRules(el);
        const arr = [];
        if (typeof rules?.Count === "number") {
          for (let i = 0; i < rules.Count; i++) arr.push(rules.GetElementAt(i));
        } else if (rules) {
          for (const r of rules) arr.push(r);
        }
        arr.forEach((rule, i) => {
          try {
            if (!rule?.selectorText) return;
            const decls = ruleDecls(rule);
            if (!Object.keys(decls).some((p) => RELEVANT.test(p))) return;
            out.push({
              origin: "InspectorUtils", ruleIndex: i,
              selector: rule.selectorText,
              source: sourceOf(rule, null),
              cssText: String(rule.style?.cssText || "").slice(0, 900),
              decls,
            });
          } catch (_) {}
        });
      } catch (e) { out.push({ origin: "InspectorUtils:error", error: String(e) }); }
    }
    return { rules: out.slice(0, limit), total: out.length, truncated: out.length > limit };
  };

  const allTabs = [...doc.querySelectorAll("tab")];
  const ours = (t) => t.hasAttribute("bgalazka-notes-item") || t.hasAttribute("bgalazka-notes-agenda-item") ||
    /^about:blank#zn-/.test(String(t._zentralNotesUrl || ""));
  const tabs = {
    note: allTabs.find((t) => t.hasAttribute("bgalazka-notes-item")) || allTabs.find((t) => ours(t) && !t.hasAttribute("bgalazka-notes-agenda-item")) || null,
    agenda: allTabs.find((t) => t.hasAttribute("bgalazka-notes-agenda-item")) || allTabs.find((t) => /^about:blank#zn-agenda-/.test(String(t._zentralNotesUrl || ""))) || null,
    normalPinnedLoaded: allTabs.find((t) => t.hasAttribute("pinned") && !t.hasAttribute("pending") && !ours(t) && !t.hasAttribute("zen-essential")) || null,
    normalPinnedPending: allTabs.find((t) => t.hasAttribute("pinned") && t.hasAttribute("pending") && !ours(t) && !t.hasAttribute("zen-essential")) || null,
  };
  const folders = {
    notesRoot: doc.querySelector('zen-folder[bgalazka-notes-folder]'),
    agendaRoot: doc.querySelector('zen-folder[bgalazka-notes-agenda-folder]') || doc.getElementById("zentral-notes-agenda"),
    agendaDay: doc.querySelector('zen-folder[bgalazka-notes-agenda-day]'),
  };
  const part = (tab, sel) => { try { return tab?.querySelector(sel) || null; } catch (_) { return null; } };
  const folderHeader = (folder) => { try { return folder?.querySelector(":scope > .tab-group-label-container") || null; } catch (_) { return null; } };
  const folderLabel = (folder) => { try { return folder?.querySelector(":scope > .tab-group-label-container label") || null; } catch (_) { return null; } };
  const chain = (el, max = 10) => {
    const out = [];
    for (let p = el; p && out.length < max; p = p.parentElement) out.push(info(p));
    return out;
  };
  const tabReport = (name, tab) => {
    if (!tab) return { name, found: false };
    const folder = tab.closest?.("zen-folder") || null;
    const label = part(tab, ".tab-label");
    const labelContainer = part(tab, ".tab-label-container");
    const sublabel = part(tab, ".zen-tab-sublabel");
    const content = part(tab, ".tab-content");
    const iconStack = part(tab, ".tab-icon-stack");
    const iconImage = part(tab, ".tab-icon-image");
    const iconPending = part(tab, ".tab-icon-pending");
    const header = folderHeader(folder);
    return {
      name, found: true,
      tab: info(tab),
      label: info(label),
      labelContainer: info(labelContainer),
      sublabel: info(sublabel),
      content: info(content),
      iconStack: info(iconStack),
      iconImage: info(iconImage),
      iconPending: info(iconPending),
      folder: info(folder),
      folderHeader: info(header),
      folderLabel: info(folderLabel(folder)),
      ancestorsFromLabel: chain(label || labelContainer || tab, 12),
      matched: {
        tab: matchedRules(tab),
        label: matchedRules(label),
        labelContainer: matchedRules(labelContainer),
        sublabel: matchedRules(sublabel),
        iconImage: matchedRules(iconImage),
        content: matchedRules(content),
        folderHeader: matchedRules(header),
      },
    };
  };
  const folderReport = (name, folder) => {
    if (!folder) return { name, found: false };
    const header = folderHeader(folder);
    const label = folderLabel(folder);
    return {
      name, found: true,
      folder: info(folder), header: info(header), label: info(label),
      matched: { folder: matchedRules(folder), header: matchedRules(header), label: matchedRules(label) },
    };
  };
  const prefInfo = (name) => {
    if (!ServicesNS?.prefs) return { name, error: "Services.prefs unavailable" };
    try {
      const t = ServicesNS.prefs.getPrefType(name);
      if (!t) return { name, type: "missing" };
      const type = ({ 32: "string", 64: "int", 128: "bool" })[t] || String(t);
      let value;
      try {
        if (t === 128) value = ServicesNS.prefs.getBoolPref(name);
        else if (t === 64) value = ServicesNS.prefs.getIntPref(name);
        else if (t === 32) value = ServicesNS.prefs.getStringPref(name);
        else value = "unsupported";
      } catch (e) { value = "ERR " + e.message; }
      return { name, type, value };
    } catch (e) { return { name, error: String(e) }; }
  };
  const prefNames = [
    "browser.tabs.fadeOutUnloadedTabs", "browser.tabs.fadeOutExplicitlyUnloadedTabs",
    "zen.tabs.vertical", "zen.sidebar.expanded", "zen.sidebar.expand-on-hover",
    "zen.workspace.zentral.notes.zen_note_favicons", "zen.workspace.zentral.notes.park_pseudo_tabs",
    "zen.workspace.zentral.notes.zen_mode", "zen.workspace.zentral.notes.agenda_position",
    "arc-grayscale-unloaded-tabs",
  ];
  let relevantPrefs = [];
  try {
    relevantPrefs = ServicesNS.prefs.getChildList("").filter((p) =>
      /grayscale|unload|fade|pending|compact|sidebar|bgalazka|zentral|notes|arc|tabbar|density/i.test(p)
    ).sort().slice(0, 300).map(prefInfo);
  } catch (e) { relevantPrefs = [{ error: String(e) }]; }

  const rootAttrs = {};
  for (const a of root.attributes || []) rootAttrs[a.name] = a.value;
  const report = {
    label: LABEL,
    when: new Date().toISOString(),
    context: {
      url: location?.href || null,
      chromeDocument: !!doc.querySelector("tab.tabbrowser-tab"),
      sidebarState: autoState,
      diagnosticLabel: LABEL,
      rootAttrs,
      rootComputed: info(root)?.computed || null,
      navigatorToolbox: info(doc.getElementById("navigator-toolbox")),
      tabbrowserTabs: info(doc.getElementById("tabbrowser-tabs")),
      pinnedSection: info(doc.querySelector(".zen-workspace-pinned-tabs-section")),
      sheets: [...doc.styleSheets].map(sheetInfo),
    },
    prefs: { named: prefNames.map(prefInfo), relevant: relevantPrefs },
    folders: Object.fromEntries(Object.entries(folders).map(([k, v]) => [k, folderReport(k, v)])),
    tabs: Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, tabReport(k, v)])),
  };
  W.__zentralSidebarDiag = report;
  const json = JSON.stringify(report, null, 2);
  W.__zentralSidebarDiagJson = json;
  const summary = Object.values(report.tabs).filter((t) => t.found).map((t) => ({
    name: t.name,
    tab: `${t.tab?.rect?.width || 0}x${t.tab?.rect?.height || 0}`,
    labelContainer: `${t.labelContainer?.rect?.width || 0}x${t.labelContainer?.rect?.height || 0}`,
    label: `${t.label?.rect?.width || 0}x${t.label?.rect?.height || 0}`,
    labelContainerDisplay: t.labelContainer?.computed?.display,
    labelContainerWidth: t.labelContainer?.computed?.width,
    labelContainerFlex: t.labelContainer?.computed?.flex,
    labelDisplay: t.label?.computed?.display,
    labelVisibility: t.label?.computed?.visibility,
    labelOpacity: t.label?.computed?.opacity,
    labelFilter: t.label?.computed?.filter,
    tabFilter: t.tab?.computed?.filter,
    tabOpacity: t.tab?.computed?.opacity,
    iconFilter: t.iconImage?.computed?.filter,
    iconOpacity: t.iconImage?.computed?.opacity,
  }));
  console.log("ZENTRAL_SIDEBAR_DIAG_JSON_START");
  console.log(json);
  console.log("ZENTRAL_SIDEBAR_DIAG_JSON_END");
  console.table(summary);
  const method = await clip(json);
  W.__zentralSidebarDiagClipboard = method;
  console.log("CLIPBOARD_OK: " + method + " — JSON is on the clipboard");
  if (method.startsWith("FAILED")) {
    console.error("Clipboard failed; the JSON is also logged above and stored in window.__zentralSidebarDiagJson");
  }
  return report;
  } catch (e) {
    const err = { error: String(e?.stack || e), partial: W.__zentralSidebarDiag || null };
    const json = JSON.stringify(err, null, 2);
    W.__zentralSidebarDiagError = err;
    W.__zentralSidebarDiagJson = json;
    console.log("ZENTRAL_SIDEBAR_DIAG_JSON_START");
    console.log(json);
    console.log("ZENTRAL_SIDEBAR_DIAG_JSON_END");
    const method = await clip(json);
    W.__zentralSidebarDiagClipboard = method;
    console.error("Diagnostic failed; error JSON copied to clipboard via " + method, e);
    return err;
  }
})();
```


If the clipboard helper is unavailable, the same JSON is still logged in the console and stored as `window.__zentralSidebarDiagJson`. Paste the clipboard JSON back here; if it is too large, include the critical sections listed in the console table plus `context`, `prefs`, `folders`, and the `matched` rules for `label`, `labelContainer`, `tab` and `iconImage` under `tabs.note` / `tabs.agenda`.
