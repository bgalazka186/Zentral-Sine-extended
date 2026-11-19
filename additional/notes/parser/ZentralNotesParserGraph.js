/*
 * ZENTRAL FILE GUIDE - additional/notes/parser/ZentralNotesParserGraph.js
 *
 * Purpose: T4.3b — the pure parser / wiki-graph / import-export decisions of Notes, outside ZentralNotes.uc.js.
 *   The sheet still owns the DOM, the store and the full Markdown reader; this part answers link, fence,
 *   title, folder, export-name, backup-manifest and backlink questions from arguments.
 * Interaction / execution: loaded as "notes-parser" by the full pack's module loader and embedded in the
 *   standalone Notes bundle. `createParserGraph(deps)` binds the few host helpers (titleOf, cleanAnchor,
 *   parseBlocks, ...) once; the pure functions are also exported individually for Node tests.
 * Ownership / failure: no pref, timer, listener, disk or network access. A missing module means the sheet
 *   uses its compatibility shim, never a crash.
 * Registration: notes-parser
 * Loaded/created by: additional/notes/ZentralNotes.uc.js
 */
(function () {
  "use strict";
  const NOTE_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,120}$/;
  const WIKI_RE = /(?<!!)\[\[([^\[\]\n|]{1,120})(?:\|([^\[\]\n]{1,120}))?\]\]/g;

  function noteLinkTarget(href) {
    let t = String(href ?? "").trim();
    if (!t || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(t) || /^[\\/]/.test(t)) return null;
    t = t.replace(/^\.\//, "");
    const hash = t.indexOf("#");
    if (hash >= 0) t = t.slice(0, hash);
    if (!t.endsWith(".md")) return null;
    let id;
    try { id = decodeURIComponent(t.slice(0, -3)); } catch (_) { return null; }
    return NOTE_ID_RE.test(id) && !id.includes("..") ? id : null;
  }

  const cleanLinkLabel = (label) => String(label ?? "").replace(/[\[\]\n]+/g, " ").replace(/\s+/g, " ").trim() || "note";

  function buildNoteLink(id, label, heading = "", deps = {}) {
    const cleanAnchor = deps.cleanAnchor || ((value) => String(value ?? ""));
    return "[" + cleanLinkLabel(label) + "](" + encodeURIComponent(id) + ".md" +
      (cleanAnchor(heading) ? "#" + cleanAnchor(heading) : "") + ")";
  }

  function insertNoteLink(value, s, e, id, label, heading = "", deps = {}) {
    const md = buildNoteLink(id, label, heading, deps);
    return { start: s, end: e, text: md, selStart: s + md.length, selEnd: s + md.length };
  }

  function nextMarkdownFence(line, fence) {
    const value = String(line ?? "");
    if (fence) {
      const close = new RegExp("^ {0,3}" + (fence.char === "`" ? "`" : "~") + "{" + fence.length + ",}[\t ]*$");
      return close.test(value) ? null : fence;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
    if (!open || (open[1][0] === "`" && open[2].includes("`"))) return null;
    return { char: open[1][0], length: open[1].length };
  }

  function mapOutsideCode(text, fn) {
    let fence = null;
    return String(text).split("\n").map((line, li) => {
      const wasFenced = !!fence;
      const next = nextMarkdownFence(line, fence);
      if (wasFenced || next) { fence = next; return line; }
      return line.split(/(`+[^`]*`+)/).map((seg, i) => (i % 2 ? seg : fn(seg, li))).join("");
    }).join("\n");
  }

  function resolveNoteTitle(notes, title, deps = {}) {
    const titleOf = deps.titleOf || ((body) => String(body || "").split("\n")[0]);
    const want = String(title ?? "").trim().toLowerCase();
    if (!want) return null;
    const hits = notes.filter((n) => !n.trashed && titleOf(n.body).toLowerCase() === want);
    hits.sort((a, b) => b.updated - a.updated || (a.id < b.id ? -1 : 1));
    return hits.length ? { id: hits[0].id, ambiguous: hits.length > 1 } : null;
  }

  function parseWikiTarget(raw) {
    let rest = String(raw ?? "").trim();
    let heading = "";
    const hash = rest.indexOf("#");
    if (hash >= 0) {
      heading = rest.slice(hash + 1).split("#").map((x) => x.trim()).filter(Boolean).pop() || "";
      rest = rest.slice(0, hash).trim();
    }
    const segs = rest.split("/").map((x) => x.trim()).filter(Boolean);
    const title = segs.pop() || "";
    return { whole: rest, path: segs, title, heading, self: !rest && hash >= 0 };
  }

  function folderLabels(folders, folderId, deps = {}) {
    const cleanFolder = deps.cleanFolder || ((value) => String(value ?? ""));
    const id = cleanFolder(folderId);
    if (!id) return [];
    const byId = new Map((folders || []).filter((f) => f && f.id).map((f) => [f.id, f]));
    const segs = id.split("/");
    return segs.map((seg, i) => {
      const f = byId.get(segs.slice(0, i + 1).join("/"));
      return String((f && f.label) || seg);
    });
  }

  const labelsEndWith = (labels, path) => path.length <= labels.length &&
    path.every((p, i) => labels[labels.length - path.length + i].toLowerCase() === p.toLowerCase());

  function folderPathMatchesNote(note, folders, path, deps = {}) {
    const cleanFolder = deps.cleanFolder || ((value) => String(value ?? ""));
    const labels = folderLabels(folders, note?.folder, deps);
    if (labelsEndWith(labels, path)) return true;
    const id = cleanFolder(note?.folder);
    if (!id || (id !== "daily" && !id.startsWith("daily/")) || !Array.isArray(path) || !path.length ||
        String(path[0]).toLowerCase() !== "daily") return false;
    return labelsEndWith(labels.slice(1), path.slice(1));
  }

  function noteLinksIn(body, resolve, deps = {}) {
    const expand = deps.expandWikiLinks || ((text) => String(text));
    const ids = new Set();
    mapOutsideCode(expand(body, resolve || (() => null)), (seg) => {
      for (const m of seg.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const id = noteLinkTarget(m[1]);
        if (id) ids.add(id);
      }
      return seg;
    });
    return ids;
  }

  function rewriteNoteLinks(body, names) {
    return mapOutsideCode(body, (seg) =>
      seg.replace(/\]\(([^\s)]+)((?:\\s+"[^"]*")?)\)/g, (all, href, title) => {
        const id = noteLinkTarget(href);
        const name = id && names.get(id);
        const hash = /#.*$/.exec(href)?.[0] || "";
        return name ? "](" + encodeURIComponent(name) + hash + title + ")" : all;
      }),
    );
  }

  function uniqueFileNames(notes, ext = "md", deps = {}) {
    const titleOf = deps.titleOf || ((body) => String(body || "").split("\n")[0]);
    const safeFileName = deps.safeFileName || ((name, fallback) => String(name || fallback || "note"));
    const used = new Set();
    return notes.map((n) => {
      const base = safeFileName(titleOf(n.body), "note");
      let name = base, i = 2;
      while (used.has(name.toLowerCase())) name = base + " " + i++;
      used.add(name.toLowerCase());
      return name + "." + ext;
    });
  }

  function exportText(body, opts = {}, deps = {}) {
    const parseBlocks = deps.parseBlocks || (() => []);
    const hideFrontMatter = deps.hideFrontMatter || ((text) => String(text));
    const blocksText = deps.blocksText || (() => "");
    return blocksText(parseBlocks(hideFrontMatter(body), false, opts)) + "\n";
  }

  const markdownExportSnapshot = (notes) => (Array.isArray(notes) ? notes : []).filter(Boolean).map((note) => ({ ...note }));

  function cleanBackupZipPath(raw) {
    const s = String(raw ?? "").replace(/\\/g, "/");
    if (!s || s.length > 240 || /[\u0000-\u001f\u007f]/.test(s)) return "";
    if (s.startsWith("/") || s.endsWith("/") || /^[A-Za-z]:/.test(s)) return "";
    const parts = s.split("/");
    if (parts.some((p) => !p || p === "." || p === "..")) return "";
    return parts.join("/");
  }

  function buildBackupManifest(input = {}, deps = {}) {
    const { notes = [], assets = [], hasMeta = false, hasCalendar = false, hasHistory = false,
      spaceMode = "shared", createdAt = Date.now() } = input;
    const cleanSpaceMode = deps.cleanSpaceMode || ((value) => (value === "space" ? "space" : "shared"));
    let live = 0, trashed = 0;
    for (const n of notes) { if (n?.trashed) trashed++; else live++; }
    return {
      format: deps.format || "zentral-notes-backup",
      version: deps.version || 1,
      createdAt: Math.max(0, Number(createdAt) || 0),
      spaceMode: cleanSpaceMode(spaceMode),
      counts: { notes: live, trashed, assets: assets.length, meta: !!hasMeta, calendar: !!hasCalendar, history: !!hasHistory },
    };
  }

  const unlinkBroken = (body, item) => mapOutsideCode(body, (seg) => seg.split(item.raw).join(item.label));

  function findBacklinks(notes, target, folders = [], deps = {}) {
    const titleOf = deps.titleOf || ((body) => String(body || "").split("\n")[0]);
    const wikiResolver = deps.wikiResolver || (() => () => null);
    const mentionRe = deps.mentionRe || (() => null);
    const hasMention = deps.hasMention || (() => false);
    const noteLinksIn = deps.noteLinksIn || (() => new Set());
    const title = titleOf(target.body);
    const resolve = wikiResolver(notes, folders);
    const mention = mentionRe(title);
    const linked = [], mentions = [];
    for (const n of notes) {
      if (n.trashed || n.id === target.id) continue;
      if (noteLinksIn(n.body, resolve).has(target.id)) linked.push(n);
      else if (mention && hasMention(n.body, mention)) mentions.push(n);
    }
    return { linked, mentions };
  }

  const pure = {
    NOTE_ID_RE, WIKI_RE, noteLinkTarget, cleanLinkLabel, buildNoteLink, insertNoteLink, nextMarkdownFence,
    mapOutsideCode, resolveNoteTitle, parseWikiTarget, folderLabels, labelsEndWith, folderPathMatchesNote,
    noteLinksIn, rewriteNoteLinks, uniqueFileNames, exportText, markdownExportSnapshot, cleanBackupZipPath,
    buildBackupManifest, unlinkBroken, findBacklinks,
  };

  // Bind the host's few helpers once, so every wrapper keeps its old signature.
  function createParserGraph(deps = {}) {
    return {
      noteLinkTarget,
      cleanLinkLabel,
      nextMarkdownFence,
      mapOutsideCode,
      parseWikiTarget,
      labelsEndWith,
      rewriteNoteLinks,
      markdownExportSnapshot,
      cleanBackupZipPath,
      unlinkBroken,
      buildNoteLink: (id, label, heading = "") => buildNoteLink(id, label, heading, deps),
      insertNoteLink: (value, s, e, id, label, heading = "") => insertNoteLink(value, s, e, id, label, heading, deps),
      resolveNoteTitle: (notes, title) => resolveNoteTitle(notes, title, deps),
      folderLabels: (folders, folderId) => folderLabels(folders, folderId, deps),
      folderPathMatchesNote: (note, folders, path) => folderPathMatchesNote(note, folders, path, deps),
      noteLinksIn: (body, resolve) => noteLinksIn(body, resolve, deps),
      uniqueFileNames: (notes, ext = "md") => uniqueFileNames(notes, ext, deps),
      exportText: (body, opts = {}) => exportText(body, opts, deps),
      buildBackupManifest: (input) => buildBackupManifest(input, deps),
      findBacklinks: (notes, target, folders = []) => findBacklinks(notes, target, folders, deps),
    };
  }

  const api = { ...pure, createParserGraph };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.ZentralModuleLoader?.define)
    window.ZentralModuleLoader.define("notes-parser", () => api);
})();
