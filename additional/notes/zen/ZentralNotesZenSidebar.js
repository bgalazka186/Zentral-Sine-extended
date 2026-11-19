/*
 * ZENTRAL FILE GUIDE - additional/notes/zen/ZentralNotesZenSidebar.js
 *
 * Purpose: T4.3c — the pure Zen-sidebar UI decisions of Notes, outside ZentralNotes.uc.js.
 *   The sheet still owns the live browser objects and the full session traversal; this part answers
 *   projection, folder-id, favicon, URL, cleanup, drop and payload questions from arguments.
 * Interaction / execution: loaded as "notes-zen-sidebar" by the full pack's module loader and embedded once in the
 *   standalone Notes bundle. `createZenSidebar(deps, config)` binds the few host helpers/constants once; the pure
 *   functions are also exported individually for Node tests.
 * Ownership / failure: no pref, timer, listener, disk or network access. `adoptNotesSubfolders` writes attributes on
 *   the elements passed to it, never on a global document. A missing part means the sheet uses its inline bodies.
 * Registration: notes-zen-sidebar
 * Loaded/created by: additional/notes/ZentralNotes.uc.js (the one build/loader entry)
 */
(function () {
  "use strict";
  const NOTE_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,120}$/;
  const DEFAULTS = Object.freeze({
    NOTES_ATTR: "bgalazka-notes-item",
    AGENDA_ATTR: "bgalazka-notes-agenda-item",
    NOTES_ZEN_ROOT_ID: "bgalazka-zentral-notes",
    NOTES_ZEN_SUB_PREFIX: "bgalazka-zentral-notes-sub_",
    ZEN_URL_PREFIX: "about:blank#zn-",
    ZEN_MODES: Object.freeze(["off", "selected", "all"]),
    TINT_HEX: Object.freeze({
      yellow: "#f5c542", green: "#4cc38a", blue: "#5aa9ff", pink: "#ff7eb6", purple: "#a78bfa",
      orange: "#ff9f43", red: "#ff6b6b", teal: "#2ec4b6", gray: "#9aa0a6",
    }),
    NOTE_ID_RE,
    PSEUDO_PAYLOAD_HINT_RE: /zn-(?:note:|new:|agenda-)|bgalazka-zentral-notes|zentral-notes-agenda|bgalazka-ephemeral-tab/,
  });
  const configValue = (config, name) => (config && name in config ? config[name] : DEFAULTS[name]);
  const cleanFolderZenSidebarDefault = (v) => (v === "hide" || v === "show" ? v : "");
  const titleOfDefault = (body) => String(body ?? "").split("\n").find((line) => line.trim()) || "";
  const projKeyDefault = (kind, id) => (kind === "folder" ? "f:" : "n:") + id;
  const cleanFolderDefault = (v) => String(v ?? "");
  const cleanLinkLabelDefault = (label) => String(label ?? "").replace(/[\[\]\n]+/g, " ").replace(/\s+/g, " ").trim() || "note";
  const buildLinkDefault = (label, href) => "[" + label + "](" + href + ")";
  const safeHrefDefault = (raw, mail = true) => (/^(?:https?:|mailto:)/i.test(String(raw)) ? String(raw) : "");
  const colorHexDefault = (name) => DEFAULTS.TINT_HEX[name] || "";
  const colorfulFolderDefaultsDefault = () => ({ b: "" });
  const noteOrderBetweenDefault = (before, after) => ((Number(before) || 0) + (Number(after) || 0)) / 2;
  const buildTreeDefault = () => ({ children: [], notes: [] });
  const filterSessionStoreStateDefault = (state) => state;

  function noteDropTarget(rows, sourceId, targetKey, position = "before", folded = false, deps = {}) {
    const cleanFolder = deps.cleanFolder || cleanFolderDefault;
    const noteOrderBetween = deps.noteOrderBetween || noteOrderBetweenDefault;
    const list = Array.isArray(rows) ? rows : [];
    const src = list.find((row) => row?.type === "note" && row.note?.id === sourceId);
    if (!src) return null;
    if (targetKey === "root") return src.note.folder ? { kind: "folder", folder: "", order: undefined } : null;
    const target = list.find((row) => row?.key === targetKey || (row?.type === "note" && row.note?.id === targetKey));
    if (!target) return null;
    if (target.type === "folder") return src.note.folder === target.node?.id ? null : { kind: "into", folder: target.node?.id || "", order: 1 };
    if (target.type !== "note") return null;
    const targetNote = target.note;
    if (!targetNote || targetNote.id === sourceId) return null;
    const folder = cleanFolder(targetNote.folder);
    const siblings = list.filter((row) => row?.type === "note" && cleanFolder(row.note?.folder) === folder);
    const at = siblings.findIndex((row) => row.note.id === targetNote.id);
    const before = position === "after" ? targetNote : siblings[at - 1]?.note;
    const after = position === "after" ? siblings[at + 1]?.note : targetNote;
    return { kind: "order", folder, order: noteOrderBetween(before?.order, after?.order), folded: Boolean(folded) };
  }

  function noteTabDropPlan(rows, sourceKey, targetKey, position = "before", deps = {}) {
    const cleanFolder = deps.cleanFolder || cleanFolderDefault;
    const drop = deps.noteDropTarget || ((r, id, key, pos) => noteDropTarget(r, id, key, pos, false, deps));
    const target = drop(rows, typeof sourceKey === "string" && sourceKey.startsWith("n:") ? sourceKey.slice(2) : sourceKey, targetKey, position);
    if (!target) return null;
    const src = Array.isArray(rows) ? rows.find((row) => row?.type === "note" && `n:${row.note?.id}` === sourceKey) : null;
    if (!src) return null;
    const sameFolder = cleanFolder(src.note?.folder) === cleanFolder(target.folder || "");
    if (!sameFolder) return { kind: "move", noteId: src.note.id, folder: target.folder || "", order: target.order === undefined ? 1 : target.order };
    if (target.order === undefined) return null;
    return { kind: "order", noteId: src.note.id, order: target.order };
  }

  function projectNotesFolder(notes, folders, deps = {}) {
    const buildTree = deps.buildTree || buildTreeDefault;
    const cleanFolderZenSidebar = deps.cleanFolderZenSidebar || cleanFolderZenSidebarDefault;
    const titleOf = deps.titleOf || titleOfDefault;
    const projKey = deps.projKey || projKeyDefault;
    const out = [];
    const walk = (node, parent, parentHidden = false) => {
      for (const f of node.children || []) {
        const own = cleanFolderZenSidebar(f.zenSidebar);
        const hidden = own === "hide" ? true : own === "show" ? false : parentHidden;
        if (hidden) { walk(f, parent, true); continue; }
        const key = projKey("folder", f.id);
        out.push({ key, kind: "folder", id: f.id, label: f.label, parent });
        walk(f, key, false);
      }
      if (!parentHidden) {
        for (const nt of node.notes || []) {
          if (nt.calendarOnly) continue;
          out.push({ key: projKey("note", nt.id), kind: "note", id: nt.id, label: titleOf(nt.body) || "Untitled note", parent });
        }
      }
    };
    walk(buildTree(notes, folders), "", false);
    return out;
  }

  function diffProjection(current, wanted, deps = {}) {
    const serializeFolderParts = deps.serializeFolderParts || ((v) => String(v ?? ""));
    const serializeFolderOpacity = deps.serializeFolderOpacity || ((v) => String(v ?? ""));
    const cleanFolderParts = deps.cleanFolderParts || ((v) => v || {});
    const cleanFolderOpacity = deps.cleanFolderOpacity || ((v) => v || {});
    const have = new Map();
    const remove = [];
    for (const e of current || []) {
      if (have.has(e.key)) remove.push(e.key + "#dup");
      else have.set(e.key, e);
    }
    const want = new Map((wanted || []).map((e) => [e.key, e]));
    const add = (wanted || []).filter((e) => !have.has(e.key));
    for (const k of have.keys()) if (!want.has(k)) remove.push(k);
    const relabel = (wanted || []).filter((e) => have.has(e.key) && have.get(e.key).label !== e.label).map((e) => ({ key: e.key, label: e.label }));
    const move = (wanted || []).filter((e) => have.has(e.key) && have.get(e.key).parent !== e.parent).map((e) => ({ key: e.key, parent: e.parent }));
    const restyle = (wanted || [])
      .filter((e) => have.has(e.key) && ((have.get(e.key).color || "") !== (e.color || "") || (have.get(e.key).icon || "") !== (e.icon || "") || serializeFolderParts(have.get(e.key).parts) !== serializeFolderParts(e.parts) || serializeFolderOpacity(have.get(e.key).opacity) !== serializeFolderOpacity(e.opacity)))
      .map((e) => ({ key: e.key, kind: e.kind, color: e.color || "", icon: e.icon || "", ...(Object.keys(cleanFolderParts(e.parts)).length ? { parts: cleanFolderParts(e.parts) } : {}), ...(Object.keys(cleanFolderOpacity(e.opacity)).length ? { opacity: cleanFolderOpacity(e.opacity) } : {}) }));
    return { add, remove, relabel, move, restyle };
  }

  function notesSubId(key, config = {}) {
    const prefix = configValue(config, "NOTES_ZEN_SUB_PREFIX");
    return prefix + String(key).replace(/^f:/, "").replace(/\//g, "_");
  }
  function notesKeyFromId(id, config = {}) {
    const prefix = configValue(config, "NOTES_ZEN_SUB_PREFIX");
    return typeof id === "string" && id.startsWith(prefix) && id.length > prefix.length
      ? "f:" + id.slice(prefix.length).replace(/_/g, "/")
      : "";
  }

  function adoptNotesSubfolders(root, deps = {}, config = {}) {
    const keyFromId = deps.notesKeyFromId || ((id) => notesKeyFromId(id, config));
    let n = 0;
    if (!root?.querySelectorAll) return n;
    const parentOf = (el) => { try { return el.parentElement?.closest?.("zen-folder") || null; } catch (_) { return null; } };
    for (const el of [...root.querySelectorAll("zen-folder")]) {
      if (el === root || el.hasAttribute("bgalazka-notes-subfolder")) continue;
      const key = keyFromId(el.id);
      if (!key) continue;
      const up = parentOf(el);
      const upKey = up && up !== root ? up.getAttribute("bgalazka-notes-subfolder") || keyFromId(up.id) : "";
      el.setAttribute("bgalazka-notes-subfolder", key);
      el.setAttribute("bgalazka-notes-label", el.getAttribute("label") || el.label || "");
      el.setAttribute("bgalazka-notes-parent", upKey || "");
      n++;
    }
    return n;
  }

  function folderZenVars(name, deps = {}) {
    const colorHex = deps.colorHex || colorHexDefault;
    const colorfulFolderDefaults = deps.colorfulFolderDefaults || colorfulFolderDefaultsDefault;
    const hex = colorHex(name) || colorfulFolderDefaults().b;
    if (!hex) return {};
    return {
      "--zen-folder-behind-bgcolor": "light-dark(color-mix(in srgb, " + hex + " 60%, gray), color-mix(in srgb, " + hex + " 60%, #c1c1c1))",
      "--zen-folder-front-bgcolor": "light-dark(color-mix(in srgb, " + hex + ", white 70%), color-mix(in srgb, " + hex + ", black 40%))",
      "--zen-folder-stroke": "light-dark(color-mix(in srgb, " + hex + " 50%, black), color-mix(in srgb, " + hex + " 15%, #ebebeb))",
    };
  }

  function noteFaviconUri(color, deps = {}, config = {}) {
    const colorHex = deps.colorHex || colorHexDefault;
    const tint = configValue(config, "TINT_HEX");
    const hex = colorHex(color) || tint.gray;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M3.5 1.5h6l3 3v9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" fill="' + hex + '"/><path d="M9.5 1.5v3h3z" fill="#000" fill-opacity=".28"/><path d="M5 7.5h6M5 9.5h6M5 11.5h4" stroke="#000" stroke-opacity=".45" stroke-width="1" stroke-linecap="round"/></svg>';
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function agendaFaviconUri(color, kind = "event", deps = {}, config = {}) {
    const colorHex = deps.colorHex || colorHexDefault;
    const tint = configValue(config, "TINT_HEX");
    const cleanKind = kind === "reminder" || kind === "more" ? kind : "event";
    const hex = colorHex(color) || (cleanKind === "more" ? tint.orange : tint.gray);
    let svg;
    if (cleanKind === "reminder") {
      svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M8 2.2a3.3 3.3 0 0 0-3.3 3.3v2.2L3.5 9.9a.75.75 0 0 0 .65 1.1h7.7a.75.75 0 0 0 .65-1.1l-1.2-2.2V5.5A3.3 3.3 0 0 0 8 2.2z" fill="' + hex + '"/><path d="M6.3 11.8a1.7 1.7 0 0 0 3.4 0" fill="none" stroke="' + hex + '" stroke-width="1.4" stroke-linecap="round"/><circle cx="12.2" cy="3.6" r="2.1" fill="' + hex + '" stroke="#000" stroke-opacity=".35" stroke-width=".9"/></svg>';
    } else if (cleanKind === "more") {
      svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="' + hex + '"/><path d="M8 4.8v3.5l2.2 1.3" fill="none" stroke="#000" stroke-opacity=".52" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    } else {
      svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="11" rx="2" fill="' + hex + '"/><path d="M2 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1.3H2z" fill="#000" fill-opacity=".28"/><path d="M5.2 1.8v2.1M10.8 1.8v2.1" stroke="#000" stroke-opacity=".48" stroke-width="1.3" stroke-linecap="round"/><rect x="5" y="8.2" width="6" height="3.6" rx=".7" fill="#000" fill-opacity=".28"/></svg>';
    }
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function sharedProjectionPlan({ active = "", targetReady = false, alreadyThere = false } = {}) {
    if (typeof active !== "string" || !active || !targetReady) return "wait";
    return alreadyThere ? "stay" : "move";
  }
  function planRootDedupe(roots) {
    const adopt = roots.length ? 0 : -1;
    const remove = [], release = [];
    roots.forEach((r, i) => { if (i === adopt) return; (r.foreign > 0 ? release : remove).push(i); });
    return { adopt, remove, release };
  }
  function planCleanup(tabs, config = {}) {
    const marker = configValue(config, "NOTES_ATTR");
    return (tabs || []).filter((t) => t && t.attrs && marker in t.attrs).map((t) => t.id);
  }
  function dropDecision({ tab, intoNotes }, deps = {}, config = {}) {
    const marker = configValue(config, "NOTES_ATTR");
    const safeHref = deps.safeHref || safeHrefDefault;
    const urlNoteBody = deps.urlNoteBody || ((title, url) => cleanLinkLabelDefault(title || url) + "\n\n" + buildLinkDefault(cleanLinkLabelDefault(title || url), url) + "\n");
    const ours = !!(tab && tab.attrs && marker in tab.attrs);
    if (ours) return intoNotes ? { action: "reposition" } : { action: "restore" };
    if (!intoNotes) return { action: "ignore" };
    const url = safeHref(tab?.url || "", false);
    return url ? { action: "capture-url", body: urlNoteBody(tab.title, url) } : { action: "reject" };
  }
  function urlNoteBody(title, url, deps = {}) {
    const cleanLinkLabel = deps.cleanLinkLabel || cleanLinkLabelDefault;
    const buildLink = deps.buildLink || buildLinkDefault;
    return cleanLinkLabel(title || url) + "\n\n" + buildLink(cleanLinkLabel(title || url), url) + "\n";
  }

  function cleanZenMode(v, config = {}) {
    return configValue(config, "ZEN_MODES").includes(v) ? v : "off";
  }
  function zenNoteUrl(id, config = {}) {
    return configValue(config, "ZEN_URL_PREFIX") + "note:" + encodeURIComponent(id);
  }
  function zenNewUrl(folderId, deps = {}, config = {}) {
    const cleanFolder = deps.cleanFolder || cleanFolderDefault;
    return configValue(config, "ZEN_URL_PREFIX") + "new:" + encodeURIComponent(cleanFolder(folderId));
  }
  function parseZenUrl(url, deps = {}, config = {}) {
    const cleanFolder = deps.cleanFolder || cleanFolderDefault;
    const prefix = configValue(config, "ZEN_URL_PREFIX");
    const noteIdRe = configValue(config, "NOTE_ID_RE");
    const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(note|new):([A-Za-z0-9%._~-]{0,300})$");
    const m = re.exec(String(url ?? ""));
    if (!m) return null;
    let v;
    try { v = decodeURIComponent(m[2]); } catch (_) { return null; }
    if (m[1] === "note") return noteIdRe.test(v) && !v.includes("..") ? { kind: "note", id: v } : null;
    return cleanFolder(v) === v ? { kind: "new", folder: v } : null;
  }

  function pseudoTabCleanupKind({ url = "", remembered = "", sessionUrl = "", notesMarked = false, agendaMarked = false } = {}, { notesEnabled = false, agendaEnabled = false } = {}, deps = {}, config = {}) {
    const parse = deps.parseZenUrl || ((value) => parseZenUrl(value, deps, config));
    const classifyUrl = (candidate) => {
      const value = String(candidate || "");
      if (/^about:blank#zn-agenda-[^\s]*$/.test(value)) return "agenda";
      if (parse(value)) return "notes";
      return "";
    };
    const cleanupFor = (kind) => kind === "agenda"
      ? (agendaMarked && agendaEnabled ? "" : "agenda")
      : kind === "notes"
        ? (notesMarked && notesEnabled ? "" : "notes")
        : "";
    const live = String(url || "");
    if (live && live !== "about:blank") return cleanupFor(classifyUrl(live));
    const current = String(sessionUrl || "");
    if (current && current !== "about:blank") return cleanupFor(classifyUrl(current));
    if (current === "about:blank") {
      if (agendaMarked) return agendaEnabled ? "" : "agenda";
      if (notesMarked) return notesEnabled ? "" : "notes";
      return "";
    }
    const prior = String(remembered || "");
    if (prior && prior !== "about:blank") {
      const kind = classifyUrl(prior);
      if (kind) return cleanupFor(kind);
    }
    if (agendaMarked) return agendaEnabled ? "" : "agenda";
    if (notesMarked) return notesEnabled ? "" : "notes";
    return "";
  }

  function filterSessionFilePayload(data, deps = {}, config = {}) {
    const filterSessionStoreState = deps.filterSessionStoreState || filterSessionStoreStateDefault;
    const hint = configValue(config, "PSEUDO_PAYLOAD_HINT_RE");
    if (typeof data === "string") {
      if (!hint.test(data)) return data;
      try {
        const parsed = JSON.parse(data);
        const filtered = filterSessionStoreState(parsed);
        return filtered === parsed ? data : JSON.stringify(filtered);
      } catch (_) { return data; }
    }
    if (data && typeof data === "object") return filterSessionStoreState(data);
    return data;
  }

  const pure = {
    DEFAULTS, noteDropTarget, noteTabDropPlan, projectNotesFolder, diffProjection, notesSubId, notesKeyFromId,
    adoptNotesSubfolders, folderZenVars, noteFaviconUri, agendaFaviconUri, sharedProjectionPlan, planRootDedupe,
    planCleanup, dropDecision, urlNoteBody, cleanZenMode, zenNoteUrl, zenNewUrl, parseZenUrl,
    pseudoTabCleanupKind, filterSessionFilePayload,
  };

  // Bind the host's few helpers and constants once, so every wrapper keeps its old signature.
  function createZenSidebar(deps = {}, config = {}) {
    return {
      noteDropTarget: (rows, sourceId, targetKey, position = "before", folded = false) =>
        noteDropTarget(rows, sourceId, targetKey, position, folded, deps, config),
      noteTabDropPlan: (rows, sourceKey, targetKey, position = "before") =>
        noteTabDropPlan(rows, sourceKey, targetKey, position, deps),
      projectNotesFolder: (notes, folders) => projectNotesFolder(notes, folders, deps),
      diffProjection: (current, wanted) => diffProjection(current, wanted, deps),
      notesSubId: (key) => notesSubId(key, config),
      notesKeyFromId: (id) => notesKeyFromId(id, config),
      adoptNotesSubfolders: (root) => adoptNotesSubfolders(root, deps, config),
      folderZenVars: (name) => folderZenVars(name, deps, config),
      noteFaviconUri: (color) => noteFaviconUri(color, deps, config),
      agendaFaviconUri: (color, kind = "event") => agendaFaviconUri(color, kind, deps, config),
      sharedProjectionPlan,
      planRootDedupe,
      planCleanup: (tabs) => planCleanup(tabs, config),
      dropDecision: (input) => dropDecision(input, deps, config),
      urlNoteBody: (title, url) => urlNoteBody(title, url, deps),
      cleanZenMode: (v) => cleanZenMode(v, config),
      zenNoteUrl: (id) => zenNoteUrl(id, config),
      zenNewUrl: (folderId) => zenNewUrl(folderId, deps, config),
      parseZenUrl: (url) => parseZenUrl(url, deps, config),
      pseudoTabCleanupKind: (input, options = {}) => pseudoTabCleanupKind(input, options, deps, config),
      filterSessionFilePayload: (data) => filterSessionFilePayload(data, deps, config),
    };
  }

  const api = { ...pure, createZenSidebar };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.ZentralModuleLoader?.define)
    window.ZentralModuleLoader.define("notes-zen-sidebar", () => api);
})();
