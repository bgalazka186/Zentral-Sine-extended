/*
 * ZENTRAL FILE GUIDE - additional/notes/ZentralNotes.uc.js
 *
 * Purpose: Quick notes. A note sheet opens over the page area of the Zentral panel whose bar you used
 *   (primary URL bar, Triple View / Super Pin bar), or as a floating card from a shortcut. Notes are plain
 *   Markdown files in a folder of your profile (or a folder you choose), never preferences.
 * Interaction / execution: Optional dock (preference) opens the floating card beside the Zen sidebar and adds a
 *   Notes button to the sidebar's bottom row. One shared store per window; every sheet shows the same notes and stays in sync,
 *   also across windows (observer notification + re-read of the changed file). Saving is a debounce with a
 *   maximum wait: shortly after you stop typing, and at least every few seconds while you keep typing.
 *   The page, panel tab and browser are never navigated, reparented or unloaded by this file.
 * Ownership / failure: Owns its buttons, sheets, observers, timers and the notes folder contents it created.
 *   A failed write keeps the note dirty and retries; nothing is discarded. No panel suite dependency: without
 *   Zentral panels only the shortcut + floating card exist (standalone mode waits for browser readiness).
 * Layout: store (files) -> pure core (format, markdown, edit helpers) -> sheet UI -> bar/host bindings.
 * Registration: notes
 * Loaded/created by: loader/ZentralCatalog.js
 * Literal DOM event subscriptions: unload
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime || window.__zentralStandaloneRuntime;

  function standaloneReady(start) {
    let started = false;
    const run = () => {
      if (started || !window.gBrowser) return;
      started = true;
      try {
        Services.obs.removeObserver(
          observer,
          "browser-delayed-startup-finished",
        );
      } catch (_) {}
      start();
    };
    const observer = {
      observe(subject, topic) {
        if (subject === window && topic === "browser-delayed-startup-finished")
          run();
      },
    };
    if (
      window.gBrowser &&
      (!window.gBrowserInit || window.gBrowserInit.delayedStartupFinished)
    )
      run();
    else {
      Services.obs.addObserver(observer, "browser-delayed-startup-finished");
      window.addEventListener(
        "unload",
        () => {
          try {
            Services.obs.removeObserver(
              observer,
              "browser-delayed-startup-finished",
            );
          } catch (_) {}
        },
        { once: true },
      );
      if (window.gBrowserInit?.delayedStartupFinished) run();
    }
  }

  (function () {
    // ======================================================================
    // Constants
    // ======================================================================
    const PREF = Object.freeze({
      ENABLED: "zen.workspace.zentral.notes.enabled",
      SHOW_BUTTON: "zen.workspace.zentral.notes.show_button",
      SHORTCUT: "zen.workspace.zentral.notes.shortcut",
      FOLDER: "zen.workspace.zentral.notes.folder",
      DOCK_SIDEBAR: "zen.workspace.zentral.notes.dock_sidebar",
      AUTOSAVE: "zen.workspace.zentral.notes.autosave_seconds",
      WRAP: "zen.workspace.zentral.notes.wrap_lines",
      FONT_SIZE: "zen.workspace.zentral.notes.font_size",
      LINE_HEIGHT: "zen.workspace.zentral.notes.line_height",
      BLANK_LINES: "zen.workspace.zentral.notes.blank_lines",
      LINE_BREAKS: "zen.workspace.zentral.notes.line_breaks",
      READ_COPY: "zen.workspace.zentral.notes.read_copy",
      SETEXT: "zen.workspace.zentral.notes.setext",
      PASTE_LINK: "zen.workspace.zentral.notes.paste_link",
      SHORTCUTS: "zen.workspace.zentral.notes.shortcuts",
      HIDDEN_TOOLS: "zen.workspace.zentral.notes.hidden_tools",
      AVOID_SIDEBAR: "zen.workspace.zentral.notes.avoid_sidebar",
      HOVER_REVEAL: "zen.workspace.zentral.notes.hover_reveal",
      PUSH_PAGE: "zen.workspace.zentral.notes.push_page",
      REVEAL_STRIP: "zen.workspace.zentral.notes.reveal_strip",
      REVEAL_HEIGHT: "zen.workspace.zentral.notes.reveal_height_px",
      REVEAL_DELAY: "zen.workspace.zentral.notes.reveal_delay_ms",
      PUSH_PANEL_PERCENT: "zen.workspace.zentral.notes.push_panel_percent",
      WIDE_PERCENT: "zen.workspace.zentral.notes.wide_percent",
      THEME: "zen.workspace.zentral.notes.theme",
      // Appearance (Notes appearance menu); "auto" / empty = keep the theme's own look
      LOOK_RADIUS: "zen.workspace.zentral.notes.look_radius",
      LOOK_BORDER: "zen.workspace.zentral.notes.look_border",
      LOOK_SHADOW_BLUR: "zen.workspace.zentral.notes.look_shadow_blur",
      LOOK_SHADOW_Y: "zen.workspace.zentral.notes.look_shadow_y",
      LOOK_SHADOW_ALPHA: "zen.workspace.zentral.notes.look_shadow_alpha",
      LOOK_OPACITY: "zen.workspace.zentral.notes.look_opacity",
      LOOK_PADDING: "zen.workspace.zentral.notes.look_padding",
      LOOK_FONT: "zen.workspace.zentral.notes.look_font",
      LOOK_EDITOR_FONT: "zen.workspace.zentral.notes.look_editor_font",
      LOOK_HEADING: "zen.workspace.zentral.notes.look_heading",
      LOOK_BTN_SIZE: "zen.workspace.zentral.notes.look_btn_size",
      LOOK_BTN_RADIUS: "zen.workspace.zentral.notes.look_btn_radius",
      LOOK_BTN_STYLE: "zen.workspace.zentral.notes.look_btn_style",
      LOOK_BTN_ICON: "zen.workspace.zentral.notes.look_btn_icon",
      LOOK_BTN_FILL: "zen.workspace.zentral.notes.look_btn_fill",
      LOOK_BTN_BORDER: "zen.workspace.zentral.notes.look_btn_border",
      LOOK_BG: "zen.workspace.zentral.notes.look_bg",
      LOOK_TEXT: "zen.workspace.zentral.notes.look_text",
      LOOK_ACCENT: "zen.workspace.zentral.notes.look_accent",
      LOOK_LINE: "zen.workspace.zentral.notes.look_line",
      // Capture: selection / page -> note
      CAPTURE_TARGET: "zen.workspace.zentral.notes.capture_target",
      CAPTURE_MENU: "zen.workspace.zentral.notes.capture_menu",
      CAPTURE_DATE: "zen.workspace.zentral.notes.capture_date",
      CAPTURE_TIME: "zen.workspace.zentral.notes.capture_time",
      CAPTURE_SOURCE: "zen.workspace.zentral.notes.capture_source",
      CAPTURE_LINK: "zen.workspace.zentral.notes.capture_link",
      CAPTURE_HIGHLIGHT: "zen.workspace.zentral.notes.capture_highlight",
      CAPTURE_CHECKBOX: "zen.workspace.zentral.notes.capture_checkbox",
      CAPTURE_STYLE: "zen.workspace.zentral.notes.capture_style",
      CAPTURE_POSITION: "zen.workspace.zentral.notes.capture_position",
      CAPTURE_OPEN: "zen.workspace.zentral.notes.capture_open",
      CAPTURE_INBOX: "zen.workspace.zentral.notes.capture_inbox",
      // Links, dates, history
      TREE_ORDER: "zen.workspace.zentral.notes.tree_order",
      FOOTER_COUNTER: "zen.workspace.zentral.notes.footer_counter",
      PIN_STRIP: "zen.workspace.zentral.notes.pinned_strip",
      FIND_HL: "zen.workspace.zentral.notes.find_highlight",
      TRASH_DAYS: "zen.workspace.zentral.notes.trash_auto_empty_days",
      SPELL: "zen.workspace.zentral.notes.spellcheck",
      SPELL_MAX: "zen.workspace.zentral.notes.spellcheck_max_chars",
      NEW_CHOOSER: "zen.workspace.zentral.notes.new_note_chooser",
      DEFAULT_VIEW: "zen.workspace.zentral.notes.default_view",
      HUB_DESC: "zen.workspace.zentral.notes.hub_descriptions",
      WIKI_COMPLETE: "zen.workspace.zentral.notes.wiki_complete",
      BACKLINKS_PANEL: "zen.workspace.zentral.notes.backlinks_panel",
      HIDDEN_MENU: "zen.workspace.zentral.notes.hidden_tools_menu",
      DATE_MODE: "zen.workspace.zentral.notes.date_notes_mode",
      HISTORY_ON: "zen.workspace.zentral.notes.history_enabled",
      HISTORY_KEEP: "zen.workspace.zentral.notes.history_keep",
      HISTORY_MINUTES: "zen.workspace.zentral.notes.history_minutes",
      HISTORY_CAP_KB: "zen.workspace.zentral.notes.history_cap_kb",
      HISTORY_WARN_MB: "zen.workspace.zentral.notes.history_warn_mb",
      // Experiments (off by default, not verified in a live Zen)
      ZEN_MODE: "zen.workspace.zentral.notes.zen_folder",
      ZEN_NEW_BUTTON: "zen.workspace.zentral.notes.zen_folder_new_button",
      ZEN_TOP: "zen.workspace.zentral.notes.zen_folder_top",
      CAPTURE_FORMAT: "zen.workspace.zentral.notes.quick_capture_format",
      DEBUG_PERF: "zen.workspace.zentral.notes.debug_perf",
    });
    const LOOK_PREFS = Object.freeze(Object.keys(PREF).filter((k) => k.startsWith("LOOK_")).map((k) => PREF[k]));
    // Integer look prefs: -1 (or anything out of range) keeps the theme's own value.
    const LOOK_NUM_PREFS = new Set([PREF.LOOK_RADIUS, PREF.LOOK_BORDER, PREF.LOOK_PADDING, PREF.LOOK_OPACITY, PREF.LOOK_SHADOW_BLUR, PREF.LOOK_SHADOW_Y, PREF.LOOK_SHADOW_ALPHA, PREF.LOOK_BTN_SIZE, PREF.LOOK_BTN_RADIUS]);
    const VIEW_PREFS = new Set([PREF.WRAP, PREF.FONT_SIZE, PREF.LINE_HEIGHT, PREF.READ_COPY, PREF.THEME, ...LOOK_PREFS]);
    const WINDOW_PREFS = new Set([PREF.HOVER_REVEAL, PREF.PUSH_PAGE, PREF.PUSH_PANEL_PERCENT, PREF.WIDE_PERCENT, PREF.REVEAL_STRIP, PREF.REVEAL_HEIGHT, PREF.REVEAL_DELAY, PREF.AVOID_SIDEBAR]);
    const READ_PREFS = new Set([PREF.BLANK_LINES, PREF.LINE_BREAKS, PREF.SETEXT, PREF.HUB_DESC, PREF.BACKLINKS_PANEL]);
    const OBS_TOPIC = "zentral-notes-changed";
    const IDLE_SAVE_MS = 800; // pause after the last keystroke
    const DEFAULT_MAX_SAVE_SECONDS = 5; // longest gap while still typing
    const TRASH_DAYS = 30; // default retention; the pref trash_auto_empty_days overrides it (0 = never)
    const TRASH_DAYS_MAX = 3650;
    // Whole days, 0 = never; anything unreadable or out of range falls back to the default.
    const cleanTrashDays = (v) => {
      const n = typeof v === "string" && v.trim() === "" ? NaN : Math.round(Number(v));
      return Number.isFinite(n) && n >= 0 && n <= TRASH_DAYS_MAX ? n : TRASH_DAYS;
    };
    // What auto-empty will do: which trashed notes are past the limit and when the next one expires (0 = nothing waiting).
    function trashPlan(notes, days, now) {
      const trashed = (notes || []).filter((n) => n && n.trashed);
      if (!days) return { days: 0, total: trashed.length, expired: [], nextMs: 0 };
      const span = days * 86400000;
      const expired = trashed.filter((n) => n.trashed < now - span).map((n) => n.id);
      const waiting = trashed.filter((n) => n.trashed >= now - span).map((n) => n.trashed + span);
      return { days, total: trashed.length, expired, nextMs: waiting.length ? Math.min(...waiting) : 0 };
    }
    function trashBanner(plan, now) {
      if (!plan.days) return "Auto-empty is off: notes stay here until you empty the Trash.";
      const head = `Notes are deleted ${plan.days} days after they were trashed, when Notes starts.`;
      if (plan.expired.length) return `${head} ${plan.expired.length} ${plan.expired.length === 1 ? "note is" : "notes are"} past that and will be deleted at the next start.`;
      if (plan.nextMs) {
        const d = Math.max(1, Math.ceil((plan.nextMs - now) / 86400000));
        return `${head} The next one expires in ${d} ${d === 1 ? "day" : "days"}.`;
      }
      return head;
    }
    const NOTE_COLORS = ["none", "yellow", "green", "blue", "pink", "purple", "orange", "red", "teal", "gray"];
    const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "orange", "purple", "red", "teal", "gray", "brown", "lime", "cyan"];
    const FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,120}\.md$/;
    const FRONT_KEYS = new Set([
      "id",
      "created",
      "updated",
      "color",
      "label",
      "pinned",
      "trashed",
      "folder",
      "remind",
      "reminded",
    ]);
    // A free-text label per note: one short line, no front matter breaking characters.
    const LABEL_MAX = 40;
    const cleanLabel = (v) => String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX).trim();
    const MAX_LIST_ROWS = 300;
    const MAX_INLINE_CHARS = 20000;
    const MAX_TABLE_COLS = 12;
    const MAX_TABLE_ROWS = 200;
    const PREVIEW_IDLE_MS = 250; // split view: re-render this long after the last keystroke
    const MAX_HIGHLIGHT_CHARS = 20000; // longer code blocks are shown without syntax colors
    const MAX_IMPORT_FILES = 500;
    const MAX_IMPORT_BYTES = 1024 * 1024;
    const MAX_RECENT = 8; // notes remembered in the "Recent" list
    const HOLD_MS = 450; // a press longer than this is a "hold" on buttons that have a second action
    const DRAG_SLOP = 3; // pixels before a press on the title becomes a drag
    const TOOLBAR_WIDGET_ID = "zentral-notes-toolbar-button";

    // ======================================================================
    // Pure core: note file format
    // ======================================================================
    const normalizeNewlines = (s) => String(s).replace(/\r\n?/g, "\n");
    const toTime = (value, fallback) => {
      const t = Date.parse(value);
      return Number.isFinite(t) ? t : fallback;
    };
    const iso = (t) => new Date(t).toISOString();

    function makeId(now = Date.now(), rnd = Math.random) {
      return (
        "n" +
        now.toString(36) +
        "-" +
        Math.floor(rnd() * 36 ** 4)
          .toString(36)
          .padStart(4, "0")
      );
    }

    // Files without our header (a .md dropped into the folder) are still
    // notes. A leading "---" block only counts as a header when it contains
    // at least one key we own, so other apps' front matter stays visible text.
    function parseNoteText(text) {
      text = normalizeNewlines(text).replace(/^\uFEFF/, "");
      const meta = {};
      let body = text;
      const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
      if (m) {
        let known = 0;
        const found = {};
        for (const line of m[1].split("\n")) {
          const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
          if (kv && FRONT_KEYS.has(kv[1])) {
            found[kv[1]] = kv[2].trim();
            known++;
          }
        }
        if (known) {
          Object.assign(meta, found);
          body = text.slice(m[0].length);
        }
      }
      return { meta, body };
    }

    function noteFromFile(id, text, mtime) {
      const { meta, body } = parseNoteText(text);
      return {
        id,
        body,
        created: toTime(meta.created, mtime),
        updated: toTime(meta.updated, mtime),
        color: NOTE_COLORS.includes(meta.color) ? meta.color : "none",
        label: cleanLabel(meta.label),
        folder: cleanFolder(meta.folder),
        pinned: meta.pinned === "true",
        trashed: meta.trashed ? toTime(meta.trashed, mtime) : 0,
        remind: meta.remind ? cleanRemind(toTime(meta.remind, 0)) : 0,
        reminded: meta.reminded ? toTime(meta.reminded, 0) : 0,
        _onDisk: true,
        _mtime: mtime,
      };
    }

    function serializeNote(n) {
      const lines = [
        "id: " + n.id,
        "created: " + iso(n.created),
        "updated: " + iso(n.updated),
      ];
      if (n.color && n.color !== "none") lines.push("color: " + n.color);
      if (cleanLabel(n.label)) lines.push("label: " + cleanLabel(n.label));
      if (cleanFolder(n.folder)) lines.push("folder: " + cleanFolder(n.folder));
      if (n.pinned) lines.push("pinned: true");
      if (n.trashed) lines.push("trashed: " + iso(n.trashed));
      if (n.remind > 0) {
        lines.push("remind: " + iso(n.remind));
        if (n.reminded > 0) lines.push("reminded: " + iso(n.reminded));
      }
      return "---\n" + lines.join("\n") + "\n---\n" + n.body;
    }


    // ======================================================================
    // Pure core: folders and the note tree (D2)
    // ======================================================================
    // A note lives in one folder path (`work/clients`, ASCII segments, max depth 4). Folder labels, order and
    // collapsed state are kept in meta.json (`folders`); a folder that only a note names still exists (its label
    // is the last segment). Pinned stays independent: a pinned note is also listed in the virtual "Pinned" row.
    const FOLDER_SEG_RE = /^[a-z0-9-]{1,40}$/;
    const FOLDER_MAX_DEPTH = 4;
    const MAX_FOLDERS = 64;
    const FOLDER_LABEL_MAX = 60;
    function cleanFolder(v) {
      if (typeof v !== "string" || !v) return "";
      const segs = v.split("/").filter(Boolean);
      if (segs.length === 0 || segs.length > FOLDER_MAX_DEPTH) return "";
      for (const s of segs) if (!FOLDER_SEG_RE.test(s)) return "";
      return segs.join("/");
    }
    function parentOfFolder(fid) {
      const segs = String(fid || "").split("/").filter(Boolean);
      segs.pop();
      return segs.join("/");
    }
    function sortNotes(a, b) {
      return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.updated || 0) - (a.updated || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }
    function buildTree(notes, folders) {
      const root = { id: "", label: "", collapsed: false, children: [], notes: [] };
      const folderNodes = new Map();
      const ensureChain = (rawId, explicitMeta = null) => {
        const cleanId = cleanFolder(rawId);
        if (!cleanId) return;
        const segs = cleanId.split("/");
        let path = "";
        for (let i = 0; i < segs.length; i++) {
          path = i === 0 ? segs[0] : path + "/" + segs[i];
          const isTarget = i === segs.length - 1 && explicitMeta;
          if (!folderNodes.has(path)) {
            folderNodes.set(path, { id: path, label: isTarget && explicitMeta.label ? String(explicitMeta.label).slice(0, 60) : segs[i], collapsed: isTarget ? Boolean(explicitMeta.collapsed) : false, children: [], notes: [], _listed: !!isTarget, _order: isTarget && typeof explicitMeta.order === "number" ? explicitMeta.order : 0 });
          } else if (isTarget) {
            const existing = folderNodes.get(path);
            if (explicitMeta.label) existing.label = String(explicitMeta.label).slice(0, 60);
            if (typeof explicitMeta.collapsed === "boolean") existing.collapsed = explicitMeta.collapsed;
            if (typeof explicitMeta.order === "number") existing._order = explicitMeta.order;
            existing._listed = true;
          }
        }
      };
      for (const f of folders || []) if (f && f.id) ensureChain(f.id, f);
      const liveNotes = (notes || []).filter((n) => n && !n.trashed);
      const notesIn = new Map();
      for (const n of liveNotes) {
        const fid = cleanFolder(n.folder);
        if (fid) ensureChain(fid);
        if (!notesIn.has(fid)) notesIn.set(fid, []);
        notesIn.get(fid).push(n);
      }
      for (const [, arr] of notesIn) arr.sort(sortNotes);
      [...folderNodes.keys()].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)).forEach((fid) => {
        const node = folderNodes.get(fid);
        const pid = parentOfFolder(fid);
        const parent = pid === "" ? root : folderNodes.get(pid) || root;
        if (!parent.children.some((c) => c.id === fid)) {
          parent.children.push(node);
          // Folders explicitly present in meta.json retain their chosen order; paths inferred only from a note's
          // `folder:` field follow afterwards, alphabetically. Otherwise a newly imported / legacy path with
          // a default order of zero could jump ahead of the user's ordered folders.
          parent.children.sort((a, b) => Number(!!b._listed) - Number(!!a._listed) || a._order - b._order || a.label.localeCompare(b.label) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        }
      });
      for (const [fid, arr] of notesIn) (fid === "" ? root : folderNodes.get(fid)).notes = arr;
      return root;
    }
    const folderDepth = (fid) => (fid ? fid.split("/").length : 0);
    const lastSeg = (fid) => String(fid || "").split("/").pop();
    const inFolder = (fid, root) => fid === root || fid.startsWith(root + "/");
    // meta.json `folders`: only valid, unique entries, at most MAX_FOLDERS.
    function cleanFolders(raw) {
      const out = [];
      const seen = new Set();
      if (!Array.isArray(raw)) return out;
      for (const f of raw) {
        const id = cleanFolder(f && f.id);
        if (!id || seen.has(id) || out.length >= MAX_FOLDERS) continue;
        seen.add(id);
        const label = String((f && f.label) ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, FOLDER_LABEL_MAX);
        out.push({ id, label: label || lastSeg(id), order: Number.isFinite(Number(f && f.order)) ? Math.round(Number(f.order)) : 0, collapsed: !!(f && f.collapsed) });
      }
      return out;
    }
    // Folder id from a label: lower-case ASCII, `-` between words, unique among `taken` ids.
    function slugFolder(label, parentId = "", taken = []) {
      let base = String(label ?? "")
        .toLowerCase()
        .replace(/\u0142/g, "l")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40)
        .replace(/-+$/, "");
      if (!base) base = "folder";
      const used = new Set(taken);
      const mk = (seg) => (parentId ? parentId + "/" : "") + seg;
      let seg = base;
      for (let n = 2; used.has(mk(seg)); n++) {
        const suffix = "-" + n;
        seg = base.slice(0, 40 - suffix.length).replace(/-+$/, "") + suffix;
      }
      return mk(seg);
    }
    // Every folder id that exists: listed in meta or named by a note (plus all their parents).
    function allFolderIds(notes, folders) {
      const ids = new Set();
      const add = (raw) => {
        const id = cleanFolder(raw);
        if (!id) return;
        const segs = id.split("/");
        for (let i = 1; i <= segs.length; i++) ids.add(segs.slice(0, i).join("/"));
      };
      for (const f of folders || []) add(f && f.id);
      for (const n of notes || []) if (n && !n.trashed) add(n.folder);
      return [...ids];
    }
    function moveNote(note, folderId) {
      return { ...note, folder: cleanFolder(folderId) };
    }
    // New folder under `parentId`. Returns {folders, id} or null (invalid parent, too deep, or MAX_FOLDERS).
    function addFolderMeta(folders, notes, parentId, label) {
      const parent = cleanFolder(parentId);
      if (parentId && !parent) return null;
      if (folderDepth(parent) >= FOLDER_MAX_DEPTH) return null;
      const list = cleanFolders(folders);
      const taken = allFolderIds(notes, list);
      if (taken.length >= MAX_FOLDERS) return null;
      const text = String(label ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, FOLDER_LABEL_MAX);
      if (!text) return null;
      const id = slugFolder(text, parent, taken);
      const order = list.filter((f) => parentOfFolder(f.id) === parent).reduce((m, f) => Math.max(m, f.order + 1), 0);
      return { folders: [...list, { id, label: text, order, collapsed: false }], id };
    }
    // Rename / collapse change the meta entry only (the id, and so every note file, stays as it is).
    function patchFolderMeta(folders, id, patch) {
      const fid = cleanFolder(id);
      if (!fid) return null;
      const list = cleanFolders(folders);
      const at = list.findIndex((f) => f.id === fid);
      const next = { ...(at >= 0 ? list[at] : { id: fid, label: lastSeg(fid), order: 0, collapsed: false }) };
      if (typeof patch.label === "string") {
        const text = patch.label.replace(/[\r\n\t]+/g, " ").trim().slice(0, FOLDER_LABEL_MAX);
        if (!text) return null;
        next.label = text;
      }
      if (typeof patch.collapsed === "boolean") next.collapsed = patch.collapsed;
      if (at >= 0) list[at] = next;
      else if (list.length < MAX_FOLDERS) list.push(next);
      else return null;
      return list;
    }
    // Delete a folder and its subfolders. Notes inside go to the root ("toRoot") or to the trash ("toTrash").
    function deleteFolder(folders, notes, id, mode = "toRoot") {
      const fid = cleanFolder(id);
      if (!fid) return null;
      const changes = [];
      for (const n of notes || []) {
        const nf = cleanFolder(n && n.folder);
        if (nf && inFolder(nf, fid) && !n.trashed) changes.push({ id: n.id, folder: "", trash: mode === "toTrash" });
      }
      return { folders: cleanFolders(folders).filter((f) => !inFolder(f.id, fid)), changes };
    }
    // Move a folder (with everything below it) under another folder; the path ids change, so the notes inside
    // are rewritten. Returns {folders, changes, id} or null (cycle, too deep, nothing to do).
    function reparentFolder(folders, notes, id, newParent) {
      const fid = cleanFolder(id);
      const parent = newParent ? cleanFolder(newParent) : "";
      if (!fid || (newParent && !parent) || parent === parentOfFolder(fid)) return null;
      if (parent && inFolder(parent, fid)) return null;
      const list = cleanFolders(folders);
      const ids = allFolderIds(notes, list);
      const family = ids.filter((x) => inFolder(x, fid));
      const span = Math.max(...family.map(folderDepth)) - folderDepth(fid) + 1;
      if (folderDepth(parent) + span > FOLDER_MAX_DEPTH) return null;
      const outside = ids.filter((x) => !inFolder(x, fid));
      const newId = slugFolder(lastSeg(fid), parent, outside);
      const remap = (x) => newId + x.slice(fid.length);
      const moved = list.map((f) => (inFolder(f.id, fid) ? { ...f, id: remap(f.id) } : f));
      const known = new Set(moved.map((f) => f.id));
      if (!known.has(newId)) moved.push({ id: newId, label: lastSeg(fid), order: 0, collapsed: false });
      const changes = [];
      for (const n of notes || []) {
        const nf = cleanFolder(n && n.folder);
        if (nf && inFolder(nf, fid)) changes.push({ id: n.id, folder: remap(nf) });
      }
      return { folders: cleanFolders(moved), changes, id: newId };
    }
    // The tree as visible rows (a collapsed folder hides what is inside). `pinned` is the virtual first row.
    const TREE_ORDERS = Object.freeze(["folders-first", "notes-first", "mixed-by-name"]);
    const cleanTreeOrder = (v) => (TREE_ORDERS.includes(v) ? v : "folders-first");
    // W9: how a panel starts. "last" keeps the mode used last time; the others force it every time a sheet opens.
    const DEFAULT_VIEWS = Object.freeze(["last", "edit", "read", "split"]);
    const cleanDefaultView = (v) => (DEFAULT_VIEWS.includes(v) ? v : "last");
    const startMode = (pref, last) => {
      const v = cleanDefaultView(pref);
      return v === "last" ? last : v;
    };
    // The children of one tree node as an ordered list of {folder} / {note}, in the chosen order. ONE function for the
    // sheet's tree and for the Zen sidebar folder, so the two can never disagree about order.
    function childSequence(node, order = "folders-first", showNotes = true) {
      order = cleanTreeOrder(order);
      const folders = node.children.map((c) => ({ folder: c }));
      const notes = showNotes ? node.notes.map((n) => ({ note: n })) : [];
      if (order === "notes-first") return [...notes, ...folders];
      if (order === "mixed-by-name") {
        // One alphabetical list; ties keep folders first. Folder order set by the user is ignored in this mode.
        const mixed = [...folders.map((m) => ({ ...m, key: String(m.folder.label || "") })), ...notes.map((m) => ({ ...m, key: titleOf(m.note.body) || "Untitled note" }))];
        mixed.sort((a, b) => a.key.localeCompare(b.key) || Number(!a.folder) - Number(!b.folder));
        return mixed.map(({ folder, note }) => (folder ? { folder } : { note }));
      }
      return [...folders, ...notes];
    }
    function treeRows(root, pinned = [], order = "folders-first") {
      const rows = [];
      if (pinned.length) {
        rows.push({ type: "pinned", depth: 0, count: pinned.length });
        for (const n of pinned) rows.push({ type: "note", depth: 1, note: n, pinnedRow: true });
      }
      const countOf = (node) => node.notes.length + node.children.reduce((s, c) => s + countOf(c), 0);
      const walk = (node, depth) => {
        const showNotes = depth === 0 || !node.collapsed;
        for (const m of childSequence(node, order, showNotes)) {
          if (m.folder) {
            rows.push({ type: "folder", depth, node: m.folder, count: countOf(m.folder) });
            if (!m.folder.collapsed) walk(m.folder, depth + 1);
          } else rows.push({ type: "note", depth, note: m.note });
        }
      };
      walk(root, 0);
      return rows;
    }

    const MARKERS_RE = /\*\*|==(?:\{\w+\})?|~~|`/g;
    const LEAD_RE =
      /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX\-/?!]\]\s+)?|\d+[.)]\s+|>\s*)/;
    function cleanLine(raw) {
      return raw.replace(LEAD_RE, "").replace(MARKERS_RE, "").trim();
    }
    function titleOf(body) {
      for (const raw of String(body).split("\n")) {
        const line = cleanLine(raw);
        if (line) return line.length > 80 ? line.slice(0, 79) + "\u2026" : line;
      }
      return "";
    }
    function snippetOf(body) {
      let seenTitle = false;
      for (const raw of String(body).split("\n")) {
        const line = cleanLine(raw);
        if (!line) continue;
        if (!seenTitle) {
          seenTitle = true;
          continue;
        }
        return line.length > 90 ? line.slice(0, 89) + "\u2026" : line;
      }
      return "";
    }
    const wordCount = (body) =>
      (String(body).match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) || []).length;
    // Footer text. Plain: "N words" (the old behaviour). Extended (pref footer_counter): words, characters and
    // reading time at 200 words a minute, rounded up; with a selection it counts the selection and says so.
    // Spell-check is the costly part of a huge note: below the limit it follows the pref, above it is off.
    const spellcheckOn = (enabled, maxChars, length) => enabled !== false && !(maxChars > 0 && length > maxChars);
    const READ_WPM = 200;
    function counterText(body, selection = "", extended = false) {
      const text = selection ? String(selection) : String(body || "");
      const words = wordCount(text);
      const label = (n) => `${n} ${n === 1 ? "word" : "words"}`;
      if (!extended) return label(wordCount(body));
      const chars = Array.from(text).length;
      const mins = words ? Math.max(1, Math.ceil(words / READ_WPM)) : 0;
      const parts = [label(words), `${chars} ${chars === 1 ? "char" : "chars"}`];
      if (mins) parts.push(`~${mins} min read`);
      return (selection ? "Selected: " : "") + parts.join(" \u00b7 ");
    }
    const safeFileName = (title, fallback = "note") =>
      (String(title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() ||
        fallback
      )
        .replace(/^\.+/, "_")
        .slice(0, 60);

    // ======================================================================
    // Pure core: autosave scheduler (debounce + maximum wait)
    // ======================================================================
    // touch() marks work pending. The work runs `idleMs` after the LAST
    // touch, but never later than `maxMs` after the FIRST touch since the
    // previous run, so typing without pause still saves on a relaxed loop.
    function createAutosaver({ idleMs, maxMs, flush, setTimer, clearTimer }) {
      let idle = null,
        max = null,
        pending = false;
      const clear = () => {
        if (idle !== null) clearTimer(idle);
        if (max !== null) clearTimer(max);
        idle = max = null;
      };
      const run = () => {
        clear();
        if (!pending) return undefined;
        pending = false;
        return flush();
      };
      return {
        touch() {
          pending = true;
          if (idle !== null) clearTimer(idle);
          idle = setTimer(run, idleMs());
          if (max === null) max = setTimer(run, maxMs());
        },
        flushNow: run,
        cancel() {
          pending = false;
          clear();
        },
        isPending: () => pending,
      };
    }

    // ======================================================================
    // Pure core: small Markdown dialect (safe: produces data, never HTML)
    // ======================================================================
    // Inline: `code`, **bold**, ==highlight== / =={green}highlight==, ~~strike~~,
    // *italic* / _italic_, [text](https://link "tooltip"), [text][ref] with a "[ref]: url" line anywhere,
    // ![alt](https://image), bare https:// links, <user@host> / mailto: links, H~2~O, X^2^, <kbd>Ctrl</kbd>
    // (links: http/https/mailto only; images: http/https only). An image is a click-to-load placeholder in the UI (nothing is fetched
    // until the person asks), so opening a note never contacts a remote server.
    const INLINE_RE = new RegExp(
      [
        "\\*\\*\\*([^\\s*](?:[\\s\\S]*?[^\\s*])?)\\*\\*\\*", // 1 bold + italic
        "(?<![\\w_])___([^\\s_](?:[\\s\\S]*?[^\\s_])?)___(?![\\w_])", // 2 bold + italic
        "(={4,}|==\\{\\w+\\}==)", // 3 empty highlight: kept as text
        "(?<![\\w_])__([^\\s_](?:[\\s\\S]*?[^\\s_])?)__(?![\\w_])", // 4 bold (underscores)
        "(`+)([\\s\\S]*?[^`])\\5(?!`)", // 5,6 code
        "\\*\\*(?=\\S)([\\s\\S]+?)(?<=\\S)\\*\\*", // 7 bold
        "==(?:\\{(\\w+)\\})?([\\s\\S]+?)==", // 8 color, 9 highlight
        "~~(?=\\S)([\\s\\S]+?)(?<=\\S)~~", // 10 strike
        "(?<![\\w*])\\*([^\\s*](?:[\\s\\S]*?[^\\s*])?)\\*(?![\\w*])", // 11 italic
        "(?<![\\w_])_([^\\s_](?:[\\s\\S]*?[^\\s_])?)_(?![\\w_])", // 12 italic
        "\\[((?:!\\[[^\\]\\n]*\\]\\([^\\s)]+\\)|[^\\]\\n])+)\\]\\(([^\\s)]+)(?:\\s+\\x22([^\\x22]*)\\x22)?\\)", // 13 text, 14 href, 15 "title" (tooltip)
        "<?(https?:\\/\\/[^\\s<>\"')\\]]+)>?", // 16 bare url, or <url>
        "!\\[([^\\]\\n]*)\\]\\(([^\\s)]+)(?:\\s+\\x22([^\\x22]*)\\x22)?\\)", // 17 alt, 18 src, 19 "title" (image)
        "(?<!~)~([^\\s~]+)~(?!~)", // 20 subscript  H~2~O
        "\\^([^\\s^]+)\\^", // 21 superscript  X^2^
        "<[kK][bB][dD]>([^<\\n]+)<\\/[kK][bB][dD]>", // 22 keyboard key
        "\\[([^\\]\\n]+)\\]\\[([^\\]\\n]*)\\]", // 23 text, 24 label (reference link, see REFS)
        "<(?:mailto:)?([^\\s<>@\\x22]+@[^\\s<>@\\x22]+\\.[^\\s<>@\\x22]+)>", // 25 <user@host.tld>
        "(?<![\\w/])mailto:([^\\s<>@\\x22]+@[^\\s<>@\\x22]+\\.[^\\s<>@\\x22,;)\\]]+)", // 26 bare mailto:user@host.tld
        "(?<![\\w$])\\$([^\\s$](?:[^$\\n]*?[^\\s$])?)\\$(?![\\d$\\w])", // 27 $math$ (not "$5 and $10": no space inside, no digit after)
        "\\[\\^([^\\]\\s]{1,40})\\]", // 28 footnote reference [^1] (see FOOTS)
      ].join("|"),
      "g",
    );
    // Links may be http, https or mailto; images (mail = false) only http and https.
    function safeHref(raw, mail = true) {
      try {
        const text = String(raw);
        if (mail && /^mailto:[^\s<>"]+@[^\s<>"]+$/i.test(text)) return text;
        const u = new URL(text);
        return /^https?:$/.test(u.protocol) ? u.href : null;
      } catch (_) {
        return null;
      }
    }

    // ======================================================================
    // Pure core: links between notes
    // ======================================================================
    // Canonical form = an ordinary Markdown link to the other note's FILE: [label](<id>.md). The id is
    // the file name without ".md" and never changes when a note is renamed or moved to another
    // folder, so the link keeps working. Anything with a scheme, a slash, "..", or another extension
    // is NOT a note link and stays an ordinary link. "[[Title]]" / "[[Title|label]]" is an editor
    // shorthand only: it is looked up by title when the note is drawn and written out as the canonical
    // link on export, so no exported file contains it. Opening a note link never touches the network.
    const NOTE_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,120}$/;
    function noteLinkTarget(href) {
      let t = String(href ?? "").trim();
      if (!t || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(t) || /^[\\/]/.test(t)) return null;
      t = t.replace(/^\.\//, "");
      const hash = t.indexOf("#");
      if (hash >= 0) t = t.slice(0, hash);
      if (!t.endsWith(".md")) return null;
      let id;
      try {
        id = decodeURIComponent(t.slice(0, -3));
      } catch (_) {
        return null;
      }
      return NOTE_ID_RE.test(id) && !id.includes("..") ? id : null;
    }
    const cleanLinkLabel = (label) => String(label ?? "").replace(/[\[\]\n]+/g, " ").replace(/\s+/g, " ").trim() || "note";
    const buildNoteLink = (id, label, heading = "") => "[" + cleanLinkLabel(label) + "](" + encodeURIComponent(id) + ".md" + (cleanAnchor(heading) ? "#" + cleanAnchor(heading) : "") + ")";
    function insertNoteLink(value, s, e, id, label, heading = "") {
      const md = buildNoteLink(id, label, heading);
      return { start: s, end: e, text: md, selStart: s + md.length, selEnd: s + md.length };
    }
    // Runs fn over the text OUTSIDE fenced code blocks and `inline code`; line count never changes.
    function mapOutsideCode(text, fn) {
      let fence = "";
      return String(text)
        .split("\n")
        .map((line, li) => {
          const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
          if (f) {
            if (!fence) fence = f[1][0];
            else if (f[1][0] === fence) fence = "";
            return line;
          }
          if (fence) return line;
          return line.split(/(`+[^`]*`+)/).map((seg, i) => (i % 2 ? seg : fn(seg, li))).join("");
        })
        .join("\n");
    }
    // Title -> id among notes that are not in the trash. Equal titles: the most recently changed note
    // wins (then the smaller id), so the choice is the same every time.
    function resolveNoteTitle(notes, title) {
      const want = String(title ?? "").trim().toLowerCase();
      if (!want) return null;
      const hits = notes.filter((n) => !n.trashed && titleOf(n.body).toLowerCase() === want);
      hits.sort((a, b) => b.updated - a.updated || (a.id < b.id ? -1 : 1));
      return hits.length ? { id: hits[0].id, ambiguous: hits.length > 1 } : null;
    }
    const WIKI_RE = /\[\[([^\[\]\n|]{1,120})(?:\|([^\[\]\n]{1,120}))?\]\]/g;
    // "unresolved": "keep" leaves [[x]] as typed (editing view); "text" writes the plain words (export).
    function expandWikiLinks(text, resolve, { unresolved = "keep" } = {}) {
      if (!String(text).includes("[[")) return String(text);
      return mapOutsideCode(text, (seg) =>
        seg.replace(WIKI_RE, (all, title, alias) => {
          const hit = resolve(title.trim());
          const id = hit && typeof hit === "object" ? hit.id : hit;
          if (id) return buildNoteLink(id, alias || title);
          return unresolved === "text" ? (alias || title).trim() : all;
        }),
      );
    }
    // Every note id a body links to (canonical links; wiki shorthand through `resolve`).
    function noteLinksIn(body, resolve) {
      const ids = new Set();
      mapOutsideCode(expandWikiLinks(body, resolve || (() => null)), (seg) => {
        for (const m of seg.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
          const id = noteLinkTarget(m[1]);
          if (id) ids.add(id);
        }
        return seg;
      });
      return ids;
    }
    // Export: links to notes in `names` (id -> exported file name) point at the exported file; links to
    // notes that are not part of the export stay as they are.
    function rewriteNoteLinks(body, names) {
      return mapOutsideCode(body, (seg) =>
        seg.replace(/\]\(([^\s)]+)((?:\s+"[^"]*")?)\)/g, (all, href, title) => {
          const id = noteLinkTarget(href);
          const name = id && names.get(id);
          const hash = /#.*$/.exec(href)?.[0] || "";
          return name ? "](" + encodeURIComponent(name) + hash + title + ")" : all;
        }),
      );
    }

    // ======================================================================
    // Pure core: Zen NOTES folder projection (Priority 3 / A groundwork, NOT WIRED to any Zen object)
    // ======================================================================
    // The native Zen folder is NOT shipped (see docs/NOTES-ZEN-FOLDER-BLOCKER.md): the proven host-folder code
    // makes real pinned tabs that Zen Sync can see, and nothing in the repo stops an ordinary tab from being
    // dropped in. These functions are the part that can be proven without Zen: what the folder should show,
    // how to reach it from what is there, and what is allowed to happen to a tab. Nothing here touches the
    // browser, a tab, a preference or Sync, and nothing calls it yet.
    const NOTES_ATTR = "bgalazka-notes-item"; // the only marker a tab needs to be treated as ours
    const projKey = (kind, id) => (kind === "folder" ? "f:" : "n:") + id;
    // Notes tree -> flat, ordered list of entries. Keys come from note ids and folder ids, never from titles.
    function projectNotesFolder(notes, folders) {
      const out = [];
      const walk = (node, parent) => {
        for (const f of node.children) {
          const key = projKey("folder", f.id);
          out.push({ key, kind: "folder", id: f.id, label: f.label, parent });
          walk(f, key); // collapsed or not, children are projected: collapsing is a display state, not identity
        }
        for (const nt of node.notes) out.push({ key: projKey("note", nt.id), kind: "note", id: nt.id, label: titleOf(nt.body) || "Untitled note", parent });
      };
      walk(buildTree(notes, folders), "");
      return out;
    }
    // What to do to make `current` (entries found in the browser, same shape) equal `wanted`. Running it again
    // on the result gives an empty plan (idempotent); duplicates of one key collapse to the first.
    function diffProjection(current, wanted) {
      const have = new Map();
      const remove = [];
      for (const e of current) {
        if (have.has(e.key)) remove.push(e.key + "#dup");
        else have.set(e.key, e);
      }
      const want = new Map(wanted.map((e) => [e.key, e]));
      const add = wanted.filter((e) => !have.has(e.key));
      for (const k of have.keys()) if (!want.has(k)) remove.push(k);
      const relabel = wanted.filter((e) => have.has(e.key) && have.get(e.key).label !== e.label).map((e) => ({ key: e.key, label: e.label }));
      const move = wanted.filter((e) => have.has(e.key) && have.get(e.key).parent !== e.parent).map((e) => ({ key: e.key, parent: e.parent }));
      return { add, remove, relabel, move };
    }
    // Cleanup may only ever remove tabs that carry our marker. Ordinary tabs are never in the plan, whatever
    // their position, folder or title.
    const planCleanup = (tabs) => tabs.filter((t) => t && t.attrs && NOTES_ATTR in t.attrs).map((t) => t.id);
    // A drag involving the NOTES folder. Never "move": a web tab is captured as a note or refused, one of our
    // entries that leaves the folder goes back, and nothing is ever closed or converted.
    function dropDecision({ tab, intoNotes }) {
      const ours = !!(tab && tab.attrs && NOTES_ATTR in tab.attrs);
      if (ours) return intoNotes ? { action: "reposition" } : { action: "restore" };
      if (!intoNotes) return { action: "ignore" };
      const url = safeHref(tab?.url || "", false);
      return url ? { action: "capture-url", body: urlNoteBody(tab.title, url) } : { action: "reject" };
    }
    // The text of a note made from a dropped web tab: its title and address, as an ordinary Markdown link.
    const urlNoteBody = (title, url) => cleanLinkLabel(title || url) + "\n\n" + buildLink(cleanLinkLabel(title || url), url) + "\n";
    // The text an export writes for a note: [[shorthand]] becomes the canonical link (or plain words when
    // nothing matches), and links to exported notes point at the exported file names (`names`: id -> file).
    const exportBody = (n, all, names = new Map()) =>
      rewriteNoteLinks(expandWikiLinks(n.body, (t) => resolveNoteTitle(all, t), { unresolved: "text" }), names);
    // Notes that link here (linked) and notes that mention the title without linking (mentions).
    function findBacklinks(notes, target) {
      const title = titleOf(target.body);
      const resolve = (t) => resolveNoteTitle(notes, t);
      const mention = mentionRe(title);
      const linked = [];
      const mentions = [];
      for (const n of notes) {
        if (n.trashed || n.id === target.id) continue;
        if (noteLinksIn(n.body, resolve).has(target.id)) linked.push(n);
        else if (mention && hasMention(n.body, mention)) mentions.push(n);
      }
      return { linked, mentions };
    }
    // Reference definitions ("[ref]: https://... "title"") of the document being parsed. Set by
    // parseBlocks for the duration of one parse; null outside it (references then stay text).
    let REFS = null;
    const refKey = (label) => String(label).trim().replace(/\s+/g, " ").toLowerCase();
    const REF_DEF_RE = /^ {0,3}\[([^\]\n]+)\]:\s+<?([^\s>]+)>?(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/;
    // Takes the definition lines out (blanked, so line numbers stay true) and returns them.
    function collectRefs(lines) {
      const refs = new Map();
      let fence = false;
      for (let i = 0; i < lines.length; i++) {
        if (/^```/.test(lines[i])) {
          fence = !fence;
          continue;
        }
        if (fence) continue;
        const m = REF_DEF_RE.exec(lines[i]);
        if (!m) continue;
        const key = refKey(m[1]);
        if (!refs.has(key)) refs.set(key, { href: m[2], title: m[3] ?? m[4] ?? m[5] ?? "" });
        lines[i] = "";
      }
      return refs;
    }

    // ======================================================================
    // Pure core: minimal offline math. A LaTeX subset becomes plain text plus sup / sub nodes
    // (no KaTeX, nothing is fetched). Anything it does not know stays visible as typed (\name).
    // $x^2$ inline, $$ ... $$ as a block. Unsupported: matrices, aligned, over/under braces.
    // ======================================================================
    const TEX_SYMBOLS = {};
    for (const [names, ch] of [
      ["alpha", "α"], ["beta", "β"], ["gamma", "γ"], ["delta", "δ"], ["epsilon", "ϵ"], ["varepsilon", "ε"], ["zeta", "ζ"], ["eta", "η"],
      ["theta", "θ"], ["vartheta", "ϑ"], ["iota", "ι"], ["kappa", "κ"], ["lambda", "λ"], ["mu", "μ"], ["nu", "ν"], ["xi", "ξ"], ["pi", "π"],
      ["rho", "ρ"], ["sigma", "σ"], ["tau", "τ"], ["upsilon", "υ"], ["phi", "ϕ"], ["varphi", "φ"], ["chi", "χ"], ["psi", "ψ"], ["omega", "ω"],
      ["Gamma", "Γ"], ["Delta", "Δ"], ["Theta", "Θ"], ["Lambda", "Λ"], ["Xi", "Ξ"], ["Pi", "Π"], ["Sigma", "Σ"], ["Upsilon", "Υ"], ["Phi", "Φ"],
      ["Psi", "Ψ"], ["Omega", "Ω"], ["times", "×"], ["cdot", "·"], ["pm", "±"], ["mp", "∓"], ["div", "÷"], ["leq le", "≤"], ["geq ge", "≥"],
      ["neq ne", "≠"], ["approx", "≈"], ["equiv", "≡"], ["sim", "∼"], ["propto", "∝"], ["infty", "∞"], ["partial", "∂"], ["nabla", "∇"],
      ["sum", "∑"], ["prod", "∏"], ["int", "∫"], ["oint", "∮"], ["in", "∈"], ["notin", "∉"], ["subset", "⊂"], ["subseteq", "⊆"], ["supset", "⊃"],
      ["cup", "∪"], ["cap", "∩"], ["emptyset", "∅"], ["forall", "∀"], ["exists", "∃"], ["neg lnot", "¬"], ["land wedge", "∧"], ["lor vee", "∨"],
      ["to rightarrow", "→"], ["leftarrow gets", "←"], ["Rightarrow implies", "⇒"], ["Leftarrow", "⇐"], ["leftrightarrow", "↔"],
      ["Leftrightarrow iff", "⇔"], ["mapsto", "↦"], ["ldots dots", "…"], ["cdots", "⋯"], ["circ", "∘"], ["degree", "°"], ["angle", "∠"],
      ["perp", "⊥"], ["parallel", "∥"], ["hbar", "ℏ"], ["ell", "ℓ"], ["prime", "′"], ["langle", "⟨"], ["rangle", "⟩"], ["ll", "≪"], ["gg", "≫"],
      ["star", "⋆"], ["bullet", "•"], ["oplus", "⊕"], ["otimes", "⊗"], ["therefore", "∴"], ["because", "∵"], ["quad qquad", "  "],
      [", ; : space !", " "],
      ["{ lbrace", "{"], ["} rbrace", "}"], ["% ", "%"], ["& ", "&"], ["# ", "#"], ["_ ", "_"], ["$ ", "$"], ["| ", "‖"],
    ])
      for (const name of names.split(" ")) if (name) TEX_SYMBOLS[name] = ch;
    TEX_SYMBOLS[" "] = " ";
    const TEX_WORDS = new Set("sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln lg exp lim max min sup inf det dim ker gcd deg arg mod".split(" "));
    const TEX_BLACKBOARD = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ" };
    const TEX_ACCENTS = { bar: "\u0304", overline: "\u0304", hat: "\u0302", widehat: "\u0302", tilde: "\u0303", widetilde: "\u0303", vec: "\u20d7", dot: "\u0307", ddot: "\u0308" };
    const TEX_MAX_DEPTH = 6;
    function texNodes(src) {
      src = String(src);
      if (src.length > 2000) return [{ t: "text", s: src }];
      const ctx = { s: src, i: 0 };
      const nodes = texSeq(ctx, 0, false);
      return nodes.length ? nodes : [{ t: "text", s: src }];
    }
    function texPush(out, node) {
      const last = out[out.length - 1];
      if (node.t === "text" && last && last.t === "text") last.s += node.s;
      else out.push(node);
    }
    // One argument: {group}, \command, or a single character.
    function texArg(ctx, depth) {
      const { s } = ctx;
      while (s[ctx.i] === " ") ctx.i++;
      if (ctx.i >= s.length) return [];
      if (s[ctx.i] === "{") {
        ctx.i++;
        return texSeq(ctx, depth + 1, true);
      }
      if (s[ctx.i] === "\\") return texCommand(ctx, depth);
      return [{ t: "text", s: s[ctx.i++] }];
    }
    function texFlat(nodes) {
      return nodes.map((n) => n.s ?? texFlat(n.c || [])).join("");
    }
    const texSimple = (nodes) => /^[\w.\u0370-\u03ff\u2200-\u22ff]+$/.test(texFlat(nodes));
    function texWrap(nodes) {
      return texSimple(nodes) ? nodes : [{ t: "text", s: "(" }, ...nodes, { t: "text", s: ")" }];
    }
    function texCommand(ctx, depth) {
      const { s } = ctx;
      ctx.i++; // the backslash
      let name = "";
      if (/[A-Za-z]/.test(s[ctx.i] || "")) while (/[A-Za-z]/.test(s[ctx.i] || "")) name += s[ctx.i++];
      else name = s[ctx.i++] || "";
      if (name === "\\") return [{ t: "text", s: " " }];
      if (name === "left" || name === "right" || name === "displaystyle" || name === "limits" || name === "nolimits") {
        if (name === "left" || name === "right") {
          if (s[ctx.i] === ".") ctx.i++; // \left. is an invisible delimiter
        }
        return [];
      }
      if (Object.prototype.hasOwnProperty.call(TEX_SYMBOLS, name)) return [{ t: "text", s: TEX_SYMBOLS[name] }];
      if (TEX_WORDS.has(name)) return [{ t: "text", s: name }];
      if (depth >= TEX_MAX_DEPTH) return [{ t: "text", s: "\\" + name }];
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const a = texArg(ctx, depth);
        const b = texArg(ctx, depth);
        return [...texWrap(a), { t: "text", s: "/" }, ...texWrap(b)];
      }
      if (name === "sqrt") {
        let root = null;
        if (s[ctx.i] === "[") {
          const end = s.indexOf("]", ctx.i);
          if (end > 0) {
            root = s.slice(ctx.i + 1, end);
            ctx.i = end + 1;
          }
        }
        const body = texArg(ctx, depth);
        return [...(root ? [{ t: "sup", c: [{ t: "text", s: root }] }] : []), { t: "text", s: "√" }, ...texWrap(body)];
      }
      if (name === "text" || name === "mathrm" || name === "operatorname" || name === "mathit" || name === "mbox" || name === "mathcal" || name === "mathsf" || name === "mathtt")
        return texArg(ctx, depth);
      if (name === "mathbf" || name === "boldsymbol" || name === "bm") return [{ t: "b", c: texArg(ctx, depth) }];
      if (name === "mathbb") {
        const a = texArg(ctx, depth);
        const f = texFlat(a);
        return [{ t: "text", s: f.length === 1 && TEX_BLACKBOARD[f] ? TEX_BLACKBOARD[f] : f }];
      }
      if (TEX_ACCENTS[name]) {
        const a = texArg(ctx, depth);
        const f = texFlat(a);
        return f ? [{ t: "text", s: f[0] + TEX_ACCENTS[name] + f.slice(1) }] : [];
      }
      return [{ t: "text", s: "\\" + name }]; // unknown: shown as typed
    }
    function texSeq(ctx, depth, inGroup) {
      const out = [];
      const { s } = ctx;
      while (ctx.i < s.length) {
        const ch = s[ctx.i];
        if (ch === "}" && inGroup) {
          ctx.i++;
          return out;
        }
        if (ch === "{") {
          ctx.i++;
          if (depth >= TEX_MAX_DEPTH) texPush(out, { t: "text", s: "{" });
          else for (const n of texSeq(ctx, depth + 1, true)) texPush(out, n);
        } else if (ch === "^" || ch === "_") {
          ctx.i++;
          const arg = depth >= TEX_MAX_DEPTH ? [{ t: "text", s: ch }] : texArg(ctx, depth);
          if (arg.length) out.push({ t: ch === "^" ? "sup" : "sub", c: arg });
        } else if (ch === "\\") {
          for (const n of texCommand(ctx, depth)) texPush(out, n);
        } else {
          ctx.i++;
          texPush(out, { t: "text", s: ch === "~" ? " " : ch });
        }
      }
      return out;
    }

    function parseInlineRaw(text, depth = 0) {
      text = String(text);
      if (depth > 4 || text.length > MAX_INLINE_CHARS)
        return text ? [{ t: "text", s: text }] : [];
      const out = [];
      let last = 0;
      const re = new RegExp(INLINE_RE.source, "g");
      for (let m; (m = re.exec(text)); ) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        if (m.index > last)
          out.push({ t: "text", s: text.slice(last, m.index) });
        last = m.index + m[0].length;
        if (m[1] !== undefined || m[2] !== undefined)
          out.push({ t: "b", c: [{ t: "i", c: parseInline(m[1] ?? m[2], depth + 1) }] });
        else if (m[3] !== undefined) out.push({ t: "text", s: m[3] }); // ==== and =={red}== stay literal
        else if (m[4] !== undefined) out.push({ t: "b", c: parseInline(m[4], depth + 1) });
        else if (m[5] !== undefined) out.push({ t: "code", s: m[6] });
        else if (m[7] !== undefined)
          out.push({ t: "b", c: parseInline(m[7], depth + 1) });
        else if (m[9] !== undefined)
          out.push({
            t: "hl",
            color: HIGHLIGHT_COLORS.includes(m[8]) ? m[8] : "yellow",
            c: parseInline(m[9], depth + 1),
          });
        else if (m[10] !== undefined)
          out.push({ t: "s", c: parseInline(m[10], depth + 1) });
        else if (m[11] !== undefined || m[12] !== undefined)
          out.push({ t: "i", c: parseInline(m[11] ?? m[12], depth + 1) });
        else if (m[17] !== undefined) {
          const asset = parseAssetLink(m[18]);
          const href = asset ? null : safeHref(m[18], false);
          if (asset) out.push({ t: "img", alt: m[17], asset: asset.rel, width: asset.width, align: asset.align });
          else if (href) out.push({ t: "img", alt: m[17], href });
          else out.push({ t: "text", s: m[0] });
        } else if (m[13] !== undefined) {
          const parts = noteLinkParts(m[14]);
          const noteId = parts?.id || null;
          const href = noteId ? null : safeHref(m[14]);
          if (noteId) {
            const a = { t: "nl", id: noteId, c: parseInline(m[13], depth + 1) };
            if (parts.heading) a.heading = parts.heading;
            if (m[15]) a.title = m[15];
            out.push(a);
          } else if (href) {
            const a = { t: "a", href, c: parseInline(m[13], depth + 1) };
            if (m[15]) a.title = m[15];
            out.push(a);
          } else out.push({ t: "text", s: m[0] });
        } else if (m[20] !== undefined) out.push({ t: "sub", c: parseInline(m[20], depth + 1) });
        else if (m[21] !== undefined) out.push({ t: "sup", c: parseInline(m[21], depth + 1) });
        else if (m[22] !== undefined) out.push({ t: "kbd", s: m[22] });
        else if (m[27] !== undefined) out.push({ t: "math", c: texNodes(m[27]) });
        else if (m[28] !== undefined) {
          // Only a label that has a definition becomes a footnote; anything else stays the text it was.
          if (FOOTS && FOOTS.has(m[28]) && (FOOT_ORDER.includes(m[28]) || FOOT_ORDER.length < FOOT_MAX)) {
            let k = FOOT_ORDER.indexOf(m[28]);
            if (k < 0) k = FOOT_ORDER.push(m[28]) - 1;
            out.push({ t: "fn", label: m[28], n: k + 1 });
          } else out.push({ t: "text", s: m[0] });
        }
        else if (m[23] !== undefined) {
          const def = REFS?.get(refKey(m[24] || m[23]));
          const href = def && safeHref(def.href);
          if (href) {
            const a = { t: "a", href, c: parseInline(m[23], depth + 1) };
            if (def.title) a.title = def.title;
            out.push(a);
          } else out.push({ t: "text", s: m[0] });
        } else if (m[25] !== undefined || m[26] !== undefined) {
          const addr = m[25] ?? m[26];
          out.push({ t: "a", href: "mailto:" + addr, c: [{ t: "text", s: addr }] });
        } else if (m[16] !== undefined) {
          let url = m[16];
          let trail = "";
          const tm = /[.,;:!?]+$/.exec(url);
          if (tm) {
            trail = tm[0];
            url = url.slice(0, -trail.length);
          }
          const href = safeHref(url);
          if (href) {
            out.push({ t: "a", href, c: [{ t: "text", s: url }] });
            if (trail) out.push({ t: "text", s: trail });
          } else out.push({ t: "text", s: m[0] });
        }
      }
      if (last < text.length) out.push({ t: "text", s: text.slice(last) });
      return out;
    }

    // Backslash escapes: \* \# \[ ... show the character itself. They are swapped for private-use
    // characters before parsing and swapped back in the finished text (so they cannot start markup).
    const ESC_CHARS = "\\`*_{}[]()#+-.!|=~<>^$";
    function parseInline(text, depth = 0) {
      text = String(text);
      if (depth > 0 || !text.includes("\\")) return parseInlineRaw(text, depth);
      const swapped = text.replace(/\\([\\`*_{}[\]()#+\-.!|=~<>^$])/g, (_m, ch) => String.fromCharCode(0xe000 + ESC_CHARS.indexOf(ch)));
      const back = (str, keepSlash) => str.replace(/[\ue000-\ue015]/g, (c) => (keepSlash ? "\\" : "") + ESC_CHARS[c.charCodeAt(0) - 0xe000]);
      const fix = (nodes) => {
        for (const n of nodes) {
          if (n.t === "text") n.s = back(n.s, false);
          else if (n.t === "code") n.s = back(n.s, true); // inside code a backslash is just a backslash
          else {
            if (n.href) n.href = back(n.href, true);
            if (n.alt) n.alt = back(n.alt, false);
            if (n.c) fix(n.c);
          }
        }
        return nodes;
      };
      return fix(parseInlineRaw(swapped, 0));
    }

    const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(?:\[( |x|X|-|\/|\?|!)\]\s+)?(.*)$/;
    // GitHub-style tables: a header row, a delimiter row with pipes (| --- | :-: |), body rows.
    const TABLE_DELIM_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
    // Raw cells with their offsets in the line: { text (untrimmed), s, e }. splitRow trims them; the task-box
    // write-back needs the offsets to change exactly one character of the source line.
    function splitRowSpans(line) {
      let from = 0,
        to = line.length;
      while (from < to && /\s/.test(line[from])) from++;
      while (to > from && /\s/.test(line[to - 1])) to--;
      if (line[from] === "|") from++;
      if (to > from && line[to - 1] === "|" && !(to - 1 > from && line[to - 2] === "\\")) to--;
      const out = [];
      let cur = "",
        s0 = from;
      for (let i = from; i < to; i++) {
        if (line[i] === "\\" && line[i + 1] === "|") {
          cur += "|";
          i++;
        } else if (line[i] === "|") {
          out.push({ text: cur, s: s0, e: i });
          cur = "";
          s0 = i + 1;
        } else cur += line[i];
      }
      out.push({ text: cur, s: s0, e: to });
      return out;
    }
    function splitRow(line) {
      return splitRowSpans(line).map((c) => c.text.trim());
    }
    // A table cell is split at <br> (the only tag it understands); a segment that starts with [ ] or [x] gets a task
    // box. `line`/`col` say where the cell lives in the note (line -1 = nested block: shown, not clickable).
    const CELL_BR_RE = /<br\s*\/?>/gi;
    const CELL_BOX_RE = /^\s*\[([ xX])\](?=\s|$)\s?/;
    function cellNodes(raw, line, col) {
      const nodes = [];
      let k = 0;
      raw.trim().split(CELL_BR_RE).forEach((seg, idx) => {
        if (idx) nodes.push({ t: "br" });
        const m = CELL_BOX_RE.exec(seg);
        if (m) {
          nodes.push({ t: "task", on: m[1] !== " ", line, col, k: k++ });
          seg = seg.slice(m[0].length);
        }
        nodes.push(...parseInline(seg.trim()));
      });
      return nodes;
    }
    // Read mode: flip the k-th task box of one table cell in the source (both [ ] and [x] ways), nothing else.
    function toggleTableBox(body, lineIndex, col, k) {
      const lines = normalizeNewlines(body).split("\n");
      const line = lines[lineIndex];
      if (line === undefined || !line.includes("|")) return body;
      const cell = splitRowSpans(line)[col];
      if (!cell) return body;
      const raw = line.slice(cell.s, cell.e);
      let at = 0,
        seen = 0;
      for (const seg of raw.split(CELL_BR_RE)) {
        const m = CELL_BOX_RE.exec(seg);
        if (m) {
          if (seen === k) {
            const pos = raw.indexOf(seg, at) + seg.indexOf("[") + 1;
            const next = raw[pos] === " " ? "x" : " ";
            lines[lineIndex] = line.slice(0, cell.s + pos) + next + line.slice(cell.s + pos + 1);
            return lines.join("\n");
          }
          seen++;
        }
        at = raw.indexOf(seg, at) + seg.length;
      }
      return body;
    }
    function isTableStart(lines, i) {
      if (i + 1 >= lines.length) return false;
      const head = lines[i],
        delim = lines[i + 1];
      if (!head.includes("|") || !delim.includes("|") || !TABLE_DELIM_RE.test(delim)) return false;
      return splitRow(head).length === splitRow(delim).length;
    }
    function parseTable(lines, start, nested = false) {
      const head = splitRow(lines[start]).slice(0, MAX_TABLE_COLS);
      const align = splitRow(lines[start + 1])
        .slice(0, MAX_TABLE_COLS)
        .map((d) => (d.startsWith(":") && d.endsWith(":") ? "center" : d.endsWith(":") ? "right" : d.startsWith(":") ? "left" : ""));
      const rows = [];
      let i = start + 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|") && rows.length < MAX_TABLE_ROWS) {
        const cells = splitRow(lines[i]).slice(0, head.length);
        while (cells.length < head.length) cells.push("");
        rows.push(cells.map((c, col) => cellNodes(c, nested ? -1 : i, col)));
        i++;
      }
      return { block: { type: "table", align, head: head.map((c) => cellNodes(c, -1, 0)), rows }, next: i };
    }
    // opts.joinLines: a single newline inside a paragraph is a space (standard Markdown) instead of
    // a line break. opts.keepBlanks: every blank line after the first adds one empty gap.
    // opts.setext: text over a line of === (heading 1) or --- (heading 2) is a heading; off, a line of
    // --- is a horizontal rule and === stays text. Top-level blocks carry a non-enumerable `src`: the
    // source line they start on (used by linked scrolling; not part of the block's signature).
    function parseBlocks(text, nested = false, opts = {}) {
      if (nested) return parseBlocksIn(text, true, opts);
      const lines = normalizeNewlines(text).split("\n");
      const before = REFS, beforeFoots = FOOTS, beforeOrder = FOOT_ORDER;
      FOOTS = collectFootnotes(lines); // before the reference links: "[^1]: text" must not be read as one
      FOOT_ORDER = [];
      REFS = collectRefs(lines);
      try {
        const blocks = parseBlocksIn(lines.join("\n"), false, opts);
        const notes = footnoteBlock(lines.length);
        if (notes) blocks.push(notes);
        return blocks;
      } finally {
        REFS = before;
        FOOTS = beforeFoots;
        FOOT_ORDER = beforeOrder;
      }
    }
    // <details> ... </details> with an optional <summary>: a collapsible block. Only these two tags (and
    // <details open>) are understood; attributes are ignored and the inner text is plain Markdown.
    const DETAILS_OPEN_RE = /^\s*<details(?:\s+open)?\s*>/i;
    const DETAILS_CLOSE_RE = /<\/details\s*>/i;
    // Returns { block, next } or null (no matching close tag: the lines stay ordinary text).
    function parseDetails(lines, start, nested, opts) {
      const first = lines[start];
      const open = /^\s*<details\s+open\s*>/i.test(first);
      const rest = first.replace(DETAILS_OPEN_RE, "");
      let depth = 1;
      const inner = [];
      let end = -1;
      for (let j = start; j < lines.length && j - start < 2000; j++) {
        const raw = j === start ? rest : lines[j];
        let line = raw;
        let scan = raw;
        for (let m; (m = /<details(?:\s+open)?\s*>|<\/details\s*>/i.exec(scan)); ) {
          const closing = m[0][1] === "/";
          depth += closing ? -1 : 1;
          if (depth === 0) {
            line = raw.slice(0, raw.length - scan.length + m.index);
            end = j;
            break;
          }
          scan = scan.slice(m.index + m[0].length);
        }
        inner.push(line);
        if (end >= 0) break;
      }
      if (end < 0) return null;
      let k = 0;
      while (k < inner.length && !inner[k].trim()) k++;
      let summary = [];
      const sm = k < inner.length ? /^\s*<summary>([\s\S]*?)<\/summary>\s*/i.exec(inner[k]) : null;
      if (sm) {
        summary = parseInline(sm[1].trim());
        inner[k] = inner[k].slice(sm[0].length);
      }
      const body = parseBlocks(inner.slice(k).join("\n"), true, opts);
      return { block: { type: "details", open, summary, blocks: body }, next: end + 1 };
    }
    // $$ x^2 $$ on one line, or $$ on its own line ... $$ on its own line.
    function parseMathBlock(lines, start) {
      const one = /^\s*\$\$(.+?)\$\$\s*$/.exec(lines[start]);
      if (one) return { block: { type: "math", c: texNodes(one[1].trim()) }, next: start + 1 };
      if (!/^\s*\$\$\s*$/.test(lines[start])) return null;
      for (let j = start + 1; j < lines.length && j - start < 200; j++) {
        if (/^\s*\$\$\s*$/.test(lines[j]))
          return { block: { type: "math", c: texNodes(lines.slice(start + 1, j).join(" ").trim()) }, next: j + 1 };
      }
      return null;
    }
    const SETEXT_RE = /^\s{0,3}(=+|-+)\s*$/;
    function parseBlocksIn(text, nested, opts) {
      const lines = normalizeNewlines(text).split("\n");
      const blocks = [];
      let i = 0;
      const startsBlock = (l) =>
        /^```/.test(l) ||
        /^#{1,6}\s+\S/.test(l) ||
        /^>/.test(l) ||
        DETAILS_OPEN_RE.test(l) ||
        /^\s*\$\$/.test(l) ||
        LIST_RE.test(l) ||
        /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l);
      while (i < lines.length) {
        const line = lines[i];
        const firstNew = blocks.length;
        const startLine = i;
        let m;
        if (!line.trim()) {
          let run = 0;
          while (i < lines.length && !lines[i].trim()) {
            run++;
            i++;
          }
          if (opts.keepBlanks && run > 1 && blocks.length && i < lines.length)
            blocks.push({ type: "gap", n: run - 1 });
        } else if (DETAILS_OPEN_RE.test(line) && (m = parseDetails(lines, i, nested, opts))) {
          blocks.push(m.block);
          i = m.next;
        } else if (/^\s*\$\$/.test(line) && (m = parseMathBlock(lines, i))) {
          blocks.push(m.block);
          i = m.next;
        } else if ((m = /^```([\w+#.-]*)\s*$/.exec(line))) {
          const buf = [];
          i++;
          while (i < lines.length && !/^```\s*$/.test(lines[i]))
            buf.push(lines[i++]);
          i++; // closing fence (or end of text)
          const code = { type: "code", text: buf.join("\n") };
          if (m[1]) code.lang = m[1].toLowerCase();
          blocks.push(code);
        } else if ((m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line))) {
          blocks.push({
            type: "h",
            level: m[1].length,
            c: parseInline(m[2]),
            line: nested ? -1 : i,
          });
          i++;
        } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
          blocks.push({ type: "hr" });
          i++;
        } else if (/^>/.test(line)) {
          const buf = [];
          while (i < lines.length && /^>/.test(lines[i]))
            buf.push(lines[i++].replace(/^>\s?/, ""));
          const inner = parseBlocks(buf.join("\n"), true, opts);
          const quote = { type: "quote", blocks: inner };
          // > [!NOTE] Title  ->  a callout (note, tip, important, warning, caution, info)
          const first = inner[0]?.type === "p" ? inner[0].c[0] : null;
          const cm = first && first.t === "text" ? /^\[!(note|tip|important|warning|caution|info)\][ \t]*(.*)$/i.exec(first.s) : null;
          if (cm) {
            quote.callout = { kind: cm[1].toLowerCase(), title: cm[2].trim() };
            inner[0].c.splice(0, inner[0].c[1]?.t === "br" ? 2 : 1);
            if (!inner[0].c.length) inner.shift();
          }
          blocks.push(quote);
        } else if ((m = LIST_RE.exec(line))) {
          const items = [];
          const counters = []; // running number per nesting level, for ordered lists
          let lastIndent = 0;
          while (i < lines.length) {
            if ((m = LIST_RE.exec(lines[i]))) {
              lastIndent = m[1].replace(/\t/g, "  ").length;
              const level = Math.min(4, Math.floor(lastIndent / 2));
              counters.length = level + 1;
              let marker = "\u2022";
              if (/^\d/.test(m[2])) {
                const n = counters[level] === undefined ? parseInt(m[2], 10) : counters[level] + 1;
                counters[level] = n;
                marker = n + m[2].slice(-1);
              } else counters[level] = undefined;
              items.push({
                level,
                marker,
                checked: m[3] === undefined ? null : m[3] === "x" || m[3] === "X",
                status: m[3] === undefined || m[3] === " " || m[3] === "x" || m[3] === "X" ? "" : m[3], // extended: - / ? !
                c: parseInline(m[4]),
                line: nested ? -1 : i,
              });
              i++;
              continue;
            }
            // A blank line followed by an indented paragraph continues the previous item.
            let j = i;
            while (j < lines.length && !lines[j].trim()) j++;
            if (j === i || j >= lines.length || LIST_RE.test(lines[j])) break;
            if (lines[j].replace(/\t/g, "  ").match(/^ */)[0].length < lastIndent + 2) break;
            const para = [];
            while (j < lines.length && lines[j].trim() && !LIST_RE.test(lines[j])) para.push(lines[j++].trim());
            const last = items[items.length - 1];
            (last.more || (last.more = [])).push(
              para.flatMap((l, idx) => (idx ? [opts.joinLines ? { t: "text", s: " " } : { t: "br" }, ...parseInline(l)] : parseInline(l))),
            );
            i = j;
          }
          blocks.push({ type: "list", items });
        } else if (isTableStart(lines, i)) {
          const t = parseTable(lines, i, nested);
          blocks.push(t.block);
          i = t.next;
        } else {
          const buf = [];
          while (
            i < lines.length &&
            lines[i].trim() &&
            !startsBlock(lines[i]) &&
            !isTableStart(lines, i) &&
            !(opts.setext && buf.length && SETEXT_RE.test(lines[i]))
          )
            buf.push(lines[i++]);
          if (!buf.length) buf.push(lines[i++]);
          const under = opts.setext && i < lines.length ? SETEXT_RE.exec(lines[i]) : null;
          if (under) {
            blocks.push({
              type: "h",
              level: under[1][0] === "=" ? 1 : 2,
              c: parseInline(buf.map((l) => l.trim()).join(" ")),
              line: nested ? -1 : startLine,
            });
            i++; // the underline
          } else {
            const c = [];
            buf.forEach((l, idx) => {
              if (idx) c.push(opts.joinLines ? { t: "text", s: " " } : { t: "br" });
              c.push(...parseInline(l));
            });
            blocks.push({ type: "p", c });
          }
        }
        if (!nested)
          for (let k = firstNew; k < blocks.length; k++) Object.defineProperty(blocks[k], "src", { value: startLine });
      }
      return blocks;
    }


    // ======================================================================
    // Pure core: syntax colors for fenced code (small, offline, a handful of languages)
    // ======================================================================
    // highlightCode(text, lang) -> [{ k, s }] where k is "" (plain), kw, lit, str, num, com, fn, prop or
    // tag. Adjacent pieces of the same kind are merged. Unknown languages, and blocks longer than
    // MAX_HIGHLIGHT_CHARS, come back as one plain piece. It only reads text; it never builds HTML.
    const words = (t) => new Set(t.split(" "));
    const C_KW = "break case continue default do else for goto if return sizeof static struct switch typedef union while const enum extern volatile void";
    const LANG_SPECS = {
      js: { kw: words("async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch throw try typeof var void while with yield as interface type enum implements public private protected readonly abstract declare namespace"), lit: words("true false null undefined NaN Infinity this"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "'", "`"], fn: true },
      py: { kw: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case"), lit: words("True False None self"), line: ["#"], quotes: ["\"", "'"], triple: true, fn: true, decorator: true },
      c: { kw: words(C_KW + " inline restrict auto register"), lit: words("true false NULL nullptr"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "'"], fn: true, preproc: true },
      cpp: { kw: words(C_KW + " class namespace template typename public private protected virtual override new delete try catch throw using auto constexpr operator this final"), lit: words("true false NULL nullptr"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "'"], fn: true, preproc: true },
      java: { kw: words("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try void volatile while var record"), lit: words("true false null"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "'"], fn: true, decorator: true },
      cs: { kw: words("abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly ref return sealed short sizeof static string struct switch this throw try typeof uint ulong unsafe ushort using var virtual void volatile while"), lit: words("true false null"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "'"], fn: true },
      go: { kw: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"), lit: words("true false nil iota"), line: ["//"], block: ["/*", "*/"], quotes: ["\"", "`", "'"], fn: true },
      rust: { kw: words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while"), lit: words("true false None Some Ok Err"), line: ["//"], block: ["/*", "*/"], quotes: ["\""], fn: true },
      sh: { kw: words("if then else elif fi for while until do done case esac in function select return exit export local readonly unset echo cd source alias"), lit: words("true false"), line: ["#"], quotes: ["\"", "'"], dollar: true, hashWord: true },
      sql: { kw: words("SELECT FROM WHERE AND OR NOT NULL INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX VIEW JOIN INNER LEFT RIGHT OUTER FULL ON AS GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT UNION ALL EXISTS IN BETWEEN LIKE IS CASE WHEN THEN ELSE END PRIMARY KEY FOREIGN REFERENCES DEFAULT UNIQUE CHECK ASC DESC COUNT SUM AVG MIN MAX"), lit: words("TRUE FALSE NULL"), line: ["--"], block: ["/*", "*/"], quotes: ["'", "\""], fold: true, fn: true },
      json: { kw: new Set(), lit: words("true false null"), line: [], quotes: ["\""], jsonKeys: true },
      css: { kw: new Set(), lit: new Set(), line: [], block: ["/*", "*/"], quotes: ["\"", "'"], css: true },
      html: { kw: new Set(), lit: new Set(), line: [], quotes: ["\"", "'"], markup: true },
    };
    const LANG_ALIAS = {
      javascript: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", typescript: "js", ts: "js", tsx: "js",
      python: "py", py: "py", c: "c", h: "c", cpp: "cpp", "c++": "cpp", cc: "cpp", hpp: "cpp",
      java: "java", csharp: "cs", "c#": "cs", cs: "cs", go: "go", golang: "go", rust: "rust", rs: "rust",
      bash: "sh", sh: "sh", shell: "sh", zsh: "sh", console: "sh", sql: "sql", json: "json", jsonc: "json",
      css: "css", html: "html", xml: "html", svg: "html", xhtml: "html",
    };
    const codeLangKey = (lang) => LANG_ALIAS[String(lang || "").toLowerCase()] || null;
    function highlightCode(text, lang) {
      text = String(text);
      const spec = LANG_SPECS[codeLangKey(lang)];
      if (!spec || text.length > MAX_HIGHLIGHT_CHARS) return text ? [{ k: "", s: text }] : [];
      const out = [];
      const push = (k, str) => {
        if (!str) return;
        const last = out[out.length - 1];
        if (last && last.k === k) last.s += str;
        else out.push({ k, s: str });
      };
      const n = text.length;
      let i = 0;
      let depth = 0; // css braces
      let inTag = false; // markup: between < and >
      const isWordStart = (c) => /[A-Za-z_$]/.test(c);
      const endOfString = (from, q) => {
        let j = from + 1;
        while (j < n) {
          if (text[j] === "\\") j += 2;
          else if (text[j] === q) return j + 1;
          else if (text[j] === "\n" && q !== "`") return j; // an unclosed string stops at the line end
          else j++;
        }
        return n;
      };
      while (i < n) {
        const c = text[i];
        // markup (html / xml)
        if (spec.markup) {
          if (text.startsWith("<!--", i)) {
            const e = text.indexOf("-->", i + 4);
            const to = e < 0 ? n : e + 3;
            push("com", text.slice(i, to));
            i = to;
            continue;
          }
          if (!inTag && c === "<" && /[A-Za-z/!?]/.test(text[i + 1] || "")) {
            const m = /^<[/!?]?[A-Za-z][\w:.-]*/.exec(text.slice(i, i + 80));
            if (m) {
              push("tag", m[0]);
              i += m[0].length;
              inTag = true;
              continue;
            }
          }
          if (inTag) {
            if (c === ">" || (c === "/" && text[i + 1] === ">")) {
              const to = c === ">" ? i + 1 : i + 2;
              push("tag", text.slice(i, to));
              i = to;
              inTag = false;
              continue;
            }
            if (c === '"' || c === "'") {
              const to = endOfString(i, c);
              push("str", text.slice(i, to));
              i = to;
              continue;
            }
            const am = /^[A-Za-z_:][\w:.-]*/.exec(text.slice(i, i + 60));
            if (am) {
              push("prop", am[0]);
              i += am[0].length;
              continue;
            }
          }
          push("", c);
          i++;
          continue;
        }
        // comments
        if (spec.block && text.startsWith(spec.block[0], i)) {
          const e = text.indexOf(spec.block[1], i + spec.block[0].length);
          const to = e < 0 ? n : e + spec.block[1].length;
          push("com", text.slice(i, to));
          i = to;
          continue;
        }
        const lc = spec.line.find((t) => text.startsWith(t, i));
        if (lc && (!spec.hashWord || i === 0 || /[\s;|&(]/.test(text[i - 1]))) {
          const e = text.indexOf("\n", i);
          const to = e < 0 ? n : e;
          push("com", text.slice(i, to));
          i = to;
          continue;
        }
        // strings
        if (spec.triple && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
          const q = text.slice(i, i + 3);
          const e = text.indexOf(q, i + 3);
          const to = e < 0 ? n : e + 3;
          push("str", text.slice(i, to));
          i = to;
          continue;
        }
        if (spec.quotes.includes(c)) {
          const to = endOfString(i, c);
          const str = text.slice(i, to);
          let kind = "str";
          if (spec.jsonKeys && /^\s*:/.test(text.slice(to, to + 40))) kind = "prop";
          push(kind, str);
          i = to;
          continue;
        }
        // css
        if (spec.css) {
          if (c === "{") depth++;
          else if (c === "}") depth = Math.max(0, depth - 1);
          const at = /^@[\w-]+/.exec(text.slice(i, i + 40));
          if (at) {
            push("kw", at[0]);
            i += at[0].length;
            continue;
          }
          const hex = /^#[0-9a-fA-F]{3,8}\b/.exec(text.slice(i, i + 12));
          if (hex && depth > 0) {
            push("num", hex[0]);
            i += hex[0].length;
            continue;
          }
          const word = /^-{0,2}[A-Za-z_][\w-]*/.exec(text.slice(i, i + 80));
          if (word && !/[\w-]/.test(text[i - 1] || "")) {
            const after = text.slice(i + word[0].length, i + word[0].length + 40);
            push(depth > 0 && /^\s*:/.test(after) ? "prop" : "", word[0]);
            i += word[0].length;
            continue;
          }
        }
        // shell variables, decorators, preprocessor lines
        if (spec.dollar && c === "$") {
          const vm = /^\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[0-9@#?*!$-])/.exec(text.slice(i, i + 80));
          if (vm) {
            push("prop", vm[0]);
            i += vm[0].length;
            continue;
          }
        }
        if (spec.decorator && c === "@" && /[A-Za-z_]/.test(text[i + 1] || "")) {
          const dm = /^@[\w.]+/.exec(text.slice(i, i + 80));
          push("fn", dm[0]);
          i += dm[0].length;
          continue;
        }
        if (spec.preproc && c === "#" && /^\s*$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i))) {
          const e = text.indexOf("\n", i);
          const to = e < 0 ? n : e;
          push("kw", text.slice(i, to));
          i = to;
          continue;
        }
        // numbers (not inside a word)
        if (/[0-9]/.test(c) && !/[\w$]/.test(text[i - 1] || "")) {
          const nm = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/.exec(text.slice(i, i + 60));
          push("num", nm[0]);
          i += nm[0].length;
          continue;
        }
        // words
        if (isWordStart(c)) {
          const wm = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 120));
          const w = wm[0];
          const key = spec.fold ? w.toUpperCase() : w;
          let kind = "";
          if (spec.kw.has(key)) kind = "kw";
          else if (spec.lit.has(key)) kind = "lit";
          else if (spec.fn && /^\s?\(/.test(text.slice(i + w.length, i + w.length + 2))) kind = "fn";
          push(kind, w);
          i += w.length;
          continue;
        }
        push("", c);
        i++;
      }
      return out;
    }

    // ======================================================================
    // Pure core: linked scrolling (map the top visible source line to the rendered block)
    // ======================================================================
    // Anchors are [{ line, y }] sorted by both fields: where a source line starts in a pane. mapPosition
    // converts a position in one pane to the other by straight-line interpolation between the two
    // anchors around it, so the same source line stays at the top of both panes whatever their line
    // heights are. `from` / `to` name the fields ("y" or "line").
    function mapPosition(anchors, value, from, to) {
      const n = anchors.length;
      if (!n) return 0;
      if (value <= anchors[0][from]) return anchors[0][to];
      if (value >= anchors[n - 1][from]) return anchors[n - 1][to];
      let lo = 0,
        hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (anchors[mid][from] <= value) lo = mid;
        else hi = mid;
      }
      const a = anchors[lo],
        b = anchors[hi];
      const span = b[from] - a[from];
      return span > 0 ? a[to] + ((value - a[from]) / span) * (b[to] - a[to]) : a[to];
    }
    // Anchors for the rendered pane: one per top-level block (or list item) with its source line and
    // the offset of its first node; `ends` closes the list at the total line count / scroll height.
    function mergeAnchors(list, endLine, endY) {
      const out = [];
      for (const a of list) {
        const last = out[out.length - 1];
        if (last && (a.line <= last.line || a.y <= last.y)) continue; // keep both fields strictly increasing
        out.push(a);
      }
      const last = out[out.length - 1];
      if (!last || (endLine > last.line && endY > last.y)) out.push({ line: endLine, y: endY });
      if (!out.length || out[0].line > 0) out.unshift({ line: 0, y: 0 });
      return out;
    }

    // ======================================================================
    // Pure core: incremental preview (which blocks need to be drawn again)
    // ======================================================================
    // A block's signature is its parsed data. Comparing signatures finds the unchanged leading and
    // trailing blocks, so typing inside one paragraph redraws only that paragraph. (Blocks that
    // carry a source line number change signature when lines are added above them, which is the
    // price of checkboxes that always toggle the right line.)
    const blockSig = (b) => JSON.stringify(b);
    function diffSigs(prev, next) {
      const max = Math.min(prev.length, next.length);
      let prefix = 0;
      while (prefix < max && prev[prefix] === next[prefix]) prefix++;
      let suffix = 0;
      while (suffix < max - prefix && prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
      return { prefix, suffix };
    }

    // ======================================================================
    // Pure core: export (HTML and plain text are built from the parsed blocks, never from raw input)
    // ======================================================================
    const EXPORT_FORMATS = Object.freeze({
      md: {
        label: "Markdown",
        ext: "md",
        loses: "Nothing in the text is lost. The note\u2019s color, pin and dates are not part of the file. Links to other notes point at their files (id.md): they work after \u201cExport all\u201d or the zip, not when one note is saved alone.",
      },
      html: {
        label: "HTML page",
        ext: "html",
        loses:
          "Highlight colors, tables, links, images, sub/superscript and keys are kept. Code blocks keep their text but lose their syntax colors. Checkboxes become read-only, images load from the web when you open the file, and the note\u2019s color, pin and dates are not included.",
      },
      txt: {
        label: "Plain text",
        ext: "txt",
        loses:
          "All formatting is dropped: bold, italic, strikethrough, highlights, sub/superscript and heading sizes disappear. Links are written as text followed by the address, images become [image: description], tables become rows separated by \" | \".",
      },
      pdf: {
        label: "PDF (print)",
        ext: "html",
        loses:
          "The note opens as a page in a tab and your browser\u2019s print dialog appears: choose \u201cSave as PDF\u201d. Page breaks are decided by the browser, images load from the web, checkboxes are read-only, and the note\u2019s color, pin and dates are not included.",
      },
      zip: {
        label: "Zip of all notes",
        ext: "zip",
        loses: "Each note becomes one .md file. Trashed notes are skipped. Note colors, pins and dates are not part of the files.",
      },
    });
    const escHtml = (t) =>
      String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    function inlineHtml(nodes) {
      let out = "";
      for (const n of nodes) {
        if (n.t === "text") out += escHtml(n.s);
        else if (n.t === "br") out += "<br>";
        else if (n.t === "task") out += '<input type="checkbox" disabled' + (n.on ? " checked" : "") + "> ";
        else if (n.t === "math") out += '<span class="math">' + inlineHtml(n.c) + "</span>";
        else if (n.t === "code") out += "<code>" + escHtml(n.s) + "</code>";
        else if (n.t === "img") out += n.asset ? '<span class="zn-picture">[picture: ' + escHtml(n.alt || "image") + "]</span>" : '<img src="' + escHtml(n.href) + '" alt="' + escHtml(n.alt) + '">';
        else if (n.t === "a") {
          // data-bare: the visible text already is the address, so the print stylesheet must not repeat it.
          const bare = inlineText(n.c).replace(/\/$/, "") === String(n.href).replace(/\/$/, "");
          out += '<a href="' + escHtml(n.href) + '"' + (n.title ? ' title="' + escHtml(n.title) + '"' : "") + (bare ? " data-bare" : "") + ' rel="noopener noreferrer">' + inlineHtml(n.c) + "</a>";
        }
        else if (n.t === "nl") out += '<span class="note-link">' + inlineHtml(n.c) + "</span>"; // no address: a single exported note cannot reach the others
        else if (n.t === "kbd") out += "<kbd>" + escHtml(n.s) + "</kbd>";
        else if (n.t === "fn") out += '<sup class="fn"><a href="#fn-' + n.n + '" id="fnref-' + n.n + '">' + n.n + "</a></sup>";
        else if (n.t === "hl") out += '<mark data-color="' + escHtml(n.color) + '">' + inlineHtml(n.c) + "</mark>";
        else {
          const tag = { b: "strong", i: "em", s: "del", sub: "sub", sup: "sup" }[n.t];
          if (tag) out += "<" + tag + ">" + inlineHtml(n.c) + "</" + tag + ">";
        }
      }
      return out;
    }
    function listHtml(items) {
      let out = "";
      const stack = [];
      for (const it of items) {
        const tag = /^\d/.test(it.marker) ? "ol" : "ul";
        while (stack.length && stack[stack.length - 1].level > it.level) out += "</li></" + stack.pop().tag + ">";
        const top = stack[stack.length - 1];
        if (top && top.level === it.level && top.tag === tag) out += "</li>";
        else {
          if (top && top.level === it.level) out += "</li></" + stack.pop().tag + ">";
          out += "<" + tag + ">";
          stack.push({ tag, level: it.level });
        }
        out +=
          "<li>" +
          (it.checked === null ? "" : it.status ? '<span class="task-status" title="' + (TASK_STATUS_NAMES[it.status] || "") + '">' + (TASK_STATUS_MARKS[it.status] || it.status) + "</span> " : '<input type="checkbox" disabled' + (it.checked ? " checked" : "") + "> ") +
          inlineHtml(it.c) +
          (it.more || []).map((para) => "<p>" + inlineHtml(para) + "</p>").join("");
      }
      while (stack.length) out += "</li></" + stack.pop().tag + ">";
      return out;
    }
    function blocksHtml(blocks) {
      let out = "";
      for (const b of blocks) {
        if (b.type === "h") out += "<h" + b.level + ">" + inlineHtml(b.c) + "</h" + b.level + ">\n";
        else if (b.type === "p") out += "<p>" + inlineHtml(b.c) + "</p>\n";
        else if (b.type === "hr") out += "<hr>\n";
        else if (b.type === "math") out += '<p class="math-block">' + inlineHtml(b.c) + "</p>\n";
        else if (b.type === "details")
          out += "<details" + (b.open ? " open" : "") + ">\n" + (b.summary.length ? "<summary>" + inlineHtml(b.summary) + "</summary>\n" : "") + blocksHtml(b.blocks) + "</details>\n";
        else if (b.type === "code") out += "<pre><code>" + escHtml(b.text) + "</code></pre>\n";
        else if (b.type === "quote")
          out +=
            "<blockquote" + (b.callout ? ' class="callout" data-kind="' + b.callout.kind + '"' : "") + ">\n" +
            (b.callout ? "<p><strong>" + escHtml(b.callout.title || b.callout.kind[0].toUpperCase() + b.callout.kind.slice(1)) + "</strong></p>\n" : "") +
            blocksHtml(b.blocks) + "</blockquote>\n";
        else if (b.type === "list") out += listHtml(b.items) + "\n";
        else if (b.type === "footnotes")
          out += '<hr>\n<ol class="footnotes">\n' + b.items.map((it) => '<li id="fn-' + it.n + '">' + inlineHtml(it.c) + ' <a href="#fnref-' + it.n + '">\u21a9</a></li>\n').join("") + "</ol>\n";
        else if (b.type === "table") {
          const cell = (tag, c, i) =>
            "<" + tag + (b.align[i] ? ' style="text-align:' + b.align[i] + '"' : "") + ">" + inlineHtml(c) + "</" + tag + ">";
          out +=
            "<table>\n<thead><tr>" + b.head.map((c, i) => cell("th", c, i)).join("") + "</tr></thead>\n<tbody>\n" +
            b.rows.map((r) => "<tr>" + r.map((c, i) => cell("td", c, i)).join("") + "</tr>\n").join("") +
            "</tbody>\n</table>\n";
        }
      }
      return out;
    }
    const EXPORT_CSS =
      ":root{color-scheme:light dark}body{max-width:46rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif}" +
      "pre{overflow:auto;padding:.6em .8em;background:rgba(127,127,127,.15);border-radius:6px}code,kbd{font-family:ui-monospace,monospace}" +
      "kbd{padding:0 .35em;border:1px solid rgba(127,127,127,.6);border-radius:4px;font-size:.9em}" +
      "blockquote{margin:.6em 0;padding-left:1em;border-left:3px solid rgba(127,127,127,.5)}.math,.math-block{font-family:Cambria Math,STIX Two Math,serif}.math-block{text-align:center;font-size:1.1em}table{border-collapse:collapse}" +
      "th,td{border:1px solid rgba(127,127,127,.5);padding:.3em .6em}img{max-width:100%}" +
      'mark{background:#fff176;color:#000}mark[data-color=green]{background:#a5d6a7}mark[data-color=blue]{background:#90caf9}' +
      'mark[data-color=pink]{background:#f8bbd0}mark[data-color=orange]{background:#ffcc80}mark[data-color=purple]{background:#ce93d8}' +
      'mark[data-color=red]{background:#ef9a9a}mark[data-color=teal]{background:#80cbc4}' +
      'mark[data-color=gray]{background:#cfd8dc}mark[data-color=brown]{background:#bcaaa4}mark[data-color=lime]{background:#e6ee9c}mark[data-color=cyan]{background:#80deea}' +
      // Print (Cycle F #32, default on, no pref): paper colours, no page-edge margins, no split code/tables/quotes,
      // headings stay with their text, web links show their address unless the text already is the address.
      '@media print{:root{color-scheme:light}body{margin:0;max-width:none;background:#fff;color:#000;font-size:11pt}' +
      'pre,blockquote,table,tr,img,details{break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #bbb;background:#f5f5f5}' +
      'h1,h2,h3,h4,h5,h6{break-after:avoid}a{color:inherit;text-decoration:underline}' +
      'a[href^="http"]:not([data-bare])::after{content:" (" attr(href) ")";font-size:.85em;overflow-wrap:anywhere}' +
      'mark{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
    function exportHtml(body, opts = {}, { print = false } = {}) {
      const title = titleOf(body) || "Note";
      return (
        '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>' + escHtml(title) + "</title><style>" + EXPORT_CSS + "</style></head><body>\n" +
        blocksHtml(parseBlocks(body, false, opts)) +
        (print ? "<script>addEventListener('load',function(){setTimeout(function(){print()},300)})</script>\n" : "") +
        "</body></html>\n"
      );
    }
    function inlineText(nodes) {
      let out = "";
      for (const n of nodes) {
        if (n.t === "text" || n.t === "code" || n.t === "kbd") out += n.s;
        else if (n.t === "br") out += "\n";
        else if (n.t === "task") out += n.on ? "[x] " : "[ ] ";
        else if (n.t === "img") out += n.alt ? "[image: " + n.alt + "]" : "[image]";
        else if (n.t === "fn") out += "[" + n.n + "]";
        else if (n.t === "a") {
          const label = inlineText(n.c);
          out += label.replace(/\/$/, "") === n.href.replace(/\/$/, "") ? label : label + " (" + n.href + ")";
        } else out += inlineText(n.c || []);
      }
      return out;
    }
    function blocksText(blocks) {
      const parts = [];
      for (const b of blocks) {
        if (b.type === "h" || b.type === "p") parts.push(inlineText(b.c));
        else if (b.type === "hr") parts.push("----------");
        else if (b.type === "math") parts.push(inlineText(b.c));
        else if (b.type === "details") parts.push((b.summary.length ? inlineText(b.summary) + "\n\n" : "") + blocksText(b.blocks));
        else if (b.type === "code") parts.push(b.text.replace(/^/gm, "    "));
        else if (b.type === "quote")
          parts.push(((b.callout ? (b.callout.title || b.callout.kind.toUpperCase()) + "\n\n" : "") + blocksText(b.blocks)).replace(/^/gm, "> "));
        else if (b.type === "list")
          parts.push(
            b.items
              .map((it) => "  ".repeat(it.level) + (it.checked === null ? (it.marker === "\u2022" ? "-" : it.marker) : it.checked ? "[x]" : it.status ? "[" + it.status + "]" : "[ ]") + " " + inlineText(it.c) + (it.more || []).map((para) => "\n\n" + "  ".repeat(it.level + 1) + inlineText(para)).join(""))
              .join("\n"),
          );
        else if (b.type === "table")
          parts.push([b.head, ...b.rows].map((r) => r.map(inlineText).join(" | ")).join("\n"));
        else if (b.type === "footnotes") parts.push(b.items.map((it) => "[" + it.n + "] " + inlineText(it.c)).join("\n"));
      }
      return parts.join("\n\n");
    }
    const exportText = (body, opts = {}) => blocksText(parseBlocks(body, false, opts)) + "\n";
    // One file name per note, never two the same (case-insensitive), for folder and zip export.
    function uniqueFileNames(notes, ext = "md") {
      const used = new Set();
      return notes.map((n) => {
        const base = safeFileName(titleOf(n.body), "note");
        let name = base,
          i = 2;
        while (used.has(name.toLowerCase())) name = base + " " + i++;
        used.add(name.toLowerCase());
        return name + "." + ext;
      });
    }

    // ======================================================================
    // Pure core: editing helpers (return an edit; the caller applies it)
    // ======================================================================
    function wrapSelection(value, s, e, open, close = open) {
      const sel = value.slice(s, e);
      if (
        sel.length >= open.length + close.length &&
        sel.startsWith(open) &&
        sel.endsWith(close)
      ) {
        const inner = sel.slice(open.length, sel.length - close.length);
        return {
          start: s,
          end: e,
          text: inner,
          selStart: s,
          selEnd: s + inner.length,
        };
      }
      if (
        s >= open.length &&
        value.slice(s - open.length, s) === open &&
        value.slice(e, e + close.length) === close
      ) {
        const a = s - open.length;
        return {
          start: a,
          end: e + close.length,
          text: sel,
          selStart: a,
          selEnd: a + sel.length,
        };
      }
      if (s === e)
        return {
          start: s,
          end: e,
          text: open + close,
          selStart: s + open.length,
          selEnd: s + open.length,
        };
      return {
        start: s,
        end: e,
        text: open + sel + close,
        selStart: s + open.length,
        selEnd: s + open.length + sel.length,
      };
    }

    const LINE_KINDS = {
      bullet: { test: /^\s*[-*+]\s+(?!\[[ xX\-/?!]\])/, add: "- " },
      check: { test: /^\s*[-*+]\s+\[[ xX\-/?!]\]\s/, add: "- [ ] " },
      heading: { test: /^#{1,6}\s/, add: "## " },
      quote: { test: /^>\s?/, add: "> " },
      ordered: { test: /^\s*\d+[.)]\s+/, add: (n) => n + ". " },
    };
    const STRIP_PREFIX =
      /^(\s*)(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX\-/?!]\]\s+)?|#{1,6}\s+|>\s?)/;
    function toggleLinePrefix(value, s, e, kind) {
      const def = LINE_KINDS[kind];
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e);
      if (le === -1) le = value.length;
      if (e > s && value[e - 1] === "\n") le = e - 1;
      if (le < ls) le = ls;
      const lines = value.slice(ls, le).split("\n");
      const all = lines.every((l) => !l.trim() || def.test.test(l));
      let count = 0;
      const out = lines
        .map((l) => {
          if (!l.trim()) return l;
          const stripped = l.replace(STRIP_PREFIX, "$1");
          if (all) return stripped;
          count++;
          const add = typeof def.add === "function" ? def.add(count) : def.add;
          return stripped.replace(/^(\s*)/, "$1" + add);
        })
        .join("\n");
      return { start: ls, end: le, text: out, selStart: ls, selEnd: ls + out.length };
    }

    // Nest deeper (dir 1) or back out (dir -1): one more "> " on quote lines, two spaces on others.
    function nestLines(value, s, e, dir) {
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e);
      if (le === -1) le = value.length;
      if (e > s && value[e - 1] === "\n") le = e - 1;
      if (le < ls) le = ls;
      const out = value
        .slice(ls, le)
        .split("\n")
        .map((l) => {
          if (!l.trim()) return l;
          if (/^\s{0,3}>/.test(l)) return dir > 0 ? l.replace(/^(\s{0,3}(?:>\s?)+)/, "$1> ") : l.replace(/^(\s{0,3}(?:>\s?)*)>\s?/, "$1");
          return dir > 0 ? "  " + l : l.replace(/^(?: {1,2}|\t)/, "");
        })
        .join("\n");
      return { start: ls, end: le, text: out, selStart: ls, selEnd: ls + out.length };
    }

    // Horizontal rule on its own line, set off by blank lines. On an empty line it just fills it.
    function insertRule(value, s, e) {
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e);
      if (le === -1) le = value.length;
      if (!value.slice(ls, le).trim()) {
        const text = "---\n";
        return { start: ls, end: le, text, selStart: ls + text.length, selEnd: ls + text.length };
      }
      const text = "\n\n---\n\n";
      return { start: le, end: le, text, selStart: le + text.length, selEnd: le + text.length };
    }

    function continueList(value, caret) {
      const ls = value.lastIndexOf("\n", caret - 1) + 1;
      let le = value.indexOf("\n", caret);
      if (le === -1) le = value.length;
      const before = value.slice(ls, caret);
      const after = value.slice(caret, le);
      const m = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX\-/?!]\]\s+)?/.exec(before);
      if (!m) return null;
      const rest = before.slice(m[0].length);
      if (!rest.trim() && !after.trim())
        return { start: ls, end: caret, text: "", selStart: ls, selEnd: ls };
      let marker = m[2] ? m[2] + " " : Number(m[3]) + 1 + m[4] + " ";
      if (m[5]) marker += "[ ] ";
      const text = "\n" + m[1] + marker;
      return {
        start: caret,
        end: caret,
        text,
        selStart: caret + text.length,
        selEnd: caret + text.length,
      };
    }

    function toggleCheckboxLine(body, lineIndex) {
      const lines = normalizeNewlines(body).split("\n");
      if (lineIndex < 0 || lineIndex >= lines.length) return body;
      lines[lineIndex] = lines[lineIndex].replace(/\[([ xX\-/?!])\]/, (_m, c) =>
        c === "x" || c === "X" ? "[ ]" : "[x]",
      );
      return lines.join("\n");
    }

    // Extended task states (Obsidian-style, plain text in the file). Other apps show them as `[-]` text.
    const TASK_STATUSES = Object.freeze([[" ", "To do"], ["x", "Done"], ["-", "Cancelled"], ["/", "In progress"], ["?", "Question"], ["!", "Important"]]);
    const TASK_STATUS_NAMES = Object.freeze({ "-": "Cancelled", "/": "In progress", "?": "Question", "!": "Important" });
    const TASK_STATUS_MARKS = Object.freeze({ "-": "\u2715", "/": "\u25D0", "?": "?", "!": "!" });
    // Read mode: one task line gets a given state, or the next one in the cycle (like a Minesweeper flag:
    // [ ] -> [?] -> [!] -> [/] -> [-] -> [ ]; a done [x] goes back to [ ]). Only a line that already is a task is touched.
    const TASK_CYCLE = Object.freeze([" ", "?", "!", "/", "-"]);
    function setLineTaskStatus(body, lineIndex, ch) {
      if (!TASK_STATUSES.some(([k]) => k === ch)) return body;
      const lines = normalizeNewlines(body).split("\n");
      if (lineIndex < 0 || lineIndex >= lines.length) return body;
      lines[lineIndex] = lines[lineIndex].replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX\-/?!]\](?=\s)/, "$1[" + ch + "]");
      return lines.join("\n");
    }
    function cycleTaskStatus(body, lineIndex) {
      const lines = normalizeNewlines(body).split("\n");
      const m = lines[lineIndex] === undefined ? null : /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX\-/?!])\](?=\s)/.exec(lines[lineIndex]);
      if (!m) return body;
      const at = TASK_CYCLE.indexOf(m[1]);
      return setLineTaskStatus(body, lineIndex, TASK_CYCLE[at < 0 ? 0 : (at + 1) % TASK_CYCLE.length]);
    }
    // Every non-empty line of the selection becomes a task with the given state: a task line only changes its state,
    // any other line loses its list / heading / quote prefix first. Same range rules as toggleLinePrefix.
    function setTaskStatus(value, s, e, ch) {
      if (!TASK_STATUSES.some(([k]) => k === ch)) return { start: s, end: e, text: value.slice(s, e), selStart: s, selEnd: e };
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e);
      if (le === -1) le = value.length;
      if (e > s && value[e - 1] === "\n") le = e - 1;
      if (le < ls) le = ls;
      const out = value
        .slice(ls, le)
        .split("\n")
        .map((l) => {
          if (!l.trim()) return l;
          const m = /^(\s*[-*+]\s+)\[[ xX\-/?!]\](\s)/.exec(l);
          if (m) return m[1] + "[" + ch + "]" + l.slice(m[0].length - 1);
          return l.replace(STRIP_PREFIX, "$1").replace(/^(\s*)/, "$1- [" + ch + "] ");
        })
        .join("\n");
      return { start: ls, end: le, text: out, selStart: ls, selEnd: ls + out.length };
    }
    // Heading level 1..6 for the selected lines; when every line already has exactly that level the heading is removed.
    function setHeadingLevel(value, s, e, level) {
      const n = Math.max(1, Math.min(6, level | 0));
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e);
      if (le === -1) le = value.length;
      if (e > s && value[e - 1] === "\n") le = e - 1;
      if (le < ls) le = ls;
      const lines = value.slice(ls, le).split("\n");
      const same = new RegExp("^#{" + n + "}\\s");
      const all = lines.every((l) => !l.trim() || same.test(l));
      const out = lines
        .map((l) => {
          if (!l.trim()) return l;
          const stripped = l.replace(STRIP_PREFIX, "$1");
          return all ? stripped : stripped.replace(/^(\s*)/, "$1" + "#".repeat(n) + " ");
        })
        .join("\n");
      return { start: ls, end: le, text: out, selStart: ls, selEnd: ls + out.length };
    }

    // ---- insert helpers: code, links, images, tables ----------------------------------------------
    // Fenced code block on its own lines. A selection that already is a fenced block is unwrapped.
    function insertCodeBlock(value, s, e, lang = "") {
      const sel = value.slice(s, e);
      const fenced = /^```[\w+#.-]*\n([\s\S]*?)\n?```$/.exec(sel);
      if (fenced) return { start: s, end: e, text: fenced[1], selStart: s, selEnd: s + fenced[1].length };
      const lead = s > 0 && value[s - 1] !== "\n" ? "\n" : "";
      const trail = e < value.length && value[e] !== "\n" ? "\n" : "";
      const open = "```" + lang + "\n";
      const text = lead + open + sel + "\n```" + trail;
      const inner = s + lead.length + open.length;
      return { start: s, end: e, text, selStart: inner, selEnd: inner + sel.length };
    }
    // [text](address): "]" in the text and spaces or brackets in the address are escaped so the link
    // always parses back to what was typed.
    function buildLink(text, url) {
      const label = String(text).replace(/\\?\]/g, "\\]").replace(/\n+/g, " ");
      const href = String(url).trim().replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
      return "[" + label + "](" + href + ")";
    }
    function insertLink(value, s, e, text, url) {
      const md = buildLink(text, url);
      return { start: s, end: e, text: md, selStart: s + md.length, selEnd: s + md.length };
    }
    // Pasted text that is one web or mail address (nothing else) -> the safe address, or null.
    function pastedLink(raw) {
      const t = String(raw ?? "").trim();
      if (!t || /\s/.test(t) || t.length > 2000) return null;
      return /^mailto:/i.test(t) || /^https?:\/\//i.test(t) ? safeHref(t) && t : null;
    }
    // A "copy link to highlight" address (#:~:text=start,end) names the quoted words: they make a good label.
    function fragmentLabel(url) {
      const m = /#:~:text=([^&]+)/.exec(String(url));
      if (!m) return "";
      try {
        const parts = m[1].split(",").map((x) => decodeURIComponent(x.replace(/^[-]|[-]$/g, "")));
        const label = parts.length > 1 ? parts[0] + "\u2026" + parts[parts.length - 1] : parts[0];
        return label.length > 80 ? label.slice(0, 79) + "\u2026" : label;
      } catch (_) {
        return "";
      }
    }
    function insertImage(value, s, e) {
      const alt = value.slice(s, e).replace(/[\[\]\n]/g, " ").trim();
      const text = "![" + alt + "](https://)";
      const from = s + 2 + alt.length + 2;
      return { start: s, end: e, text, selStart: from, selEnd: from + 8 };
    }
    const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || lo));
    // rows counts every row including the header.
    // aligns[i] is "left", "center", "right" or "" (default) for column i.
    const alignDelim = (a) => (a === "left" ? ":---" : a === "center" ? ":---:" : a === "right" ? "---:" : "---");
    function makeTable(rows, cols, aligns = []) {
      rows = clampInt(rows, 2, MAX_TABLE_ROWS);
      cols = clampInt(cols, 1, MAX_TABLE_COLS);
      const row = (cell) => "| " + Array.from({ length: cols }, (_, i) => cell(i)).join(" | ") + " |";
      return [row((i) => "Column " + (i + 1)), row((i) => alignDelim(aligns[i])), ...Array.from({ length: rows - 1 }, () => row(() => " "))].join("\n");
    }
    function insertTable(value, s, e, rows, cols, aligns = []) {
      const table = makeTable(rows, cols, aligns);
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e);
      if (le === -1) le = value.length;
      const empty = !value.slice(ls, le).trim();
      const start = empty ? ls : le;
      const end = empty ? le : le;
      const lead = empty ? "" : "\n\n";
      const text = lead + table + "\n";
      const first = start + lead.length + 2;
      return { start, end, text, selStart: first, selEnd: first + "Column 1".length };
    }
    // Picture with an optional link around it: ![alt](src) or [![alt](src)](link). Spaces and brackets
    // in the addresses are escaped so the line parses back to what was typed.
    const escAddr = (u) => String(u).trim().replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
    function buildImage(alt, src, link = "") {
      const img = "![" + String(alt).replace(/[\[\]\n]/g, " ").trim() + "](" + escAddr(src) + ")";
      return link && safeHref(String(link).trim()) ? "[" + img + "](" + escAddr(link) + ")" : img;
    }
    function insertImageMd(value, s, e, alt, src, link = "") {
      const md = buildImage(alt, src, link);
      return { start: s, end: e, text: md, selStart: s + md.length, selEnd: s + md.length };
    }
    // Text that is one web address (http or https only: the preview loads nothing else) or null.
    const pastedWebAddress = (raw) => (/^https?:\/\//i.test(String(raw ?? "").trim()) ? pastedLink(raw) : null);
    // Languages the code highlighter knows: [fence word, label]. "" = plain text, no highlighting.
    const CODE_LANGS = Object.freeze([
      ["", "Plain text (no highlighting)"], ["js", "JavaScript / TypeScript"], ["py", "Python"], ["c", "C"], ["cpp", "C++"],
      ["java", "Java"], ["cs", "C#"], ["go", "Go"], ["rust", "Rust"], ["sh", "Shell / Bash"], ["sql", "SQL"],
      ["json", "JSON"], ["css", "CSS"], ["html", "HTML / XML"],
    ]);
    // Callouts (> [!NOTE]): kind -> label. The selected lines (or the current line) become the body;
    // on a block that already starts with a callout line only the kind changes.
    const CALLOUT_KINDS = Object.freeze([
      ["note", "Note"], ["tip", "Tip"], ["important", "Important"], ["warning", "Warning"], ["caution", "Caution"], ["info", "Info"],
    ]);
    const calloutId = (kind) => "callout" + kind[0].toUpperCase() + kind.slice(1);
    function insertCallout(value, s, e, kind) {
      kind = CALLOUT_KINDS.some((k) => k[0] === kind) ? kind : "note";
      const head = "> [!" + kind.toUpperCase() + "]";
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      let le = value.indexOf("\n", e > s ? e - 1 : e);
      if (le === -1) le = value.length;
      const lines = value.slice(ls, le).split("\n");
      let text;
      const already = /^>\s*\[!(?:note|tip|important|warning|caution|info)\]/i.exec(lines[0]);
      if (already) {
        lines[0] = head + lines[0].slice(already[0].length);
        text = lines.join("\n");
      } else if (!lines.join("").trim()) text = head + "\n> ";
      else text = head + "\n" + lines.map((l) => (l.trim() ? "> " + l : ">")).join("\n");
      return { start: ls, end: le, text, selStart: ls + text.length, selEnd: ls + text.length };
    }

    // ======================================================================
    // Pure core: shortcuts (one engine for every in-sheet action; the person can reassign any of them)
    // ======================================================================
    // An action with an empty `def` has no shortcut until the person assigns one. Every shortcut needs
    // Ctrl, Alt or Cmd, so typing is never hijacked. Overrides live in one preference, a JSON object
    // { actionId: "Ctrl+Shift+K" } where "" means "unassigned".
    const SHORTCUT_ACTIONS = Object.freeze([
      { id: "bold", label: "Bold", def: "Ctrl+B", edit: true },
      { id: "italic", label: "Italic", def: "Ctrl+I", edit: true },
      { id: "strike", label: "Strikethrough", def: "Ctrl+Shift+X", edit: true },
      { id: "highlight", label: "Highlight selection", def: "Ctrl+Shift+H", edit: true },
      { id: "code", label: "Inline code", def: "Ctrl+Shift+C", edit: true },
      { id: "codeBlock", label: "Code block", def: "Ctrl+Shift+M", edit: true },
      { id: "link", label: "Link\u2026", def: "Ctrl+Shift+K", edit: true },
      { id: "noteLink", label: "Link to another note\u2026", def: "", edit: true },
      { id: "image", label: "Image", def: "Ctrl+Shift+G", edit: true },
      { id: "footnote", label: "Footnote", def: "", edit: true },
      { id: "hubList", label: "Hub list of notes\u2026", def: "", edit: true },
      { id: "heading", label: "Heading", def: "Ctrl+Shift+1", edit: true },
      { id: "bullet", label: "Bulleted list", def: "Ctrl+Shift+8", edit: true },
      { id: "numbered", label: "Numbered list", def: "Ctrl+Shift+7", edit: true },
      { id: "check", label: "Checklist", def: "Ctrl+Shift+L", edit: true },
      { id: "quote", label: "Quote", def: "Ctrl+Shift+9", edit: true },
      { id: "table", label: "Table\u2026", def: "Ctrl+Shift+Y", edit: true },
      { id: "rule", label: "Horizontal rule", def: "", edit: true },
      { id: "indent", label: "Nest in", def: "", edit: true },
      { id: "outdent", label: "Nest out", def: "", edit: true },
      { id: "sup", label: "Superscript", def: "", edit: true },
      { id: "sub", label: "Subscript", def: "", edit: true },
      { id: "kbd", label: "Keyboard key", def: "", edit: true },
      { id: "calloutNote", label: "Callout: note", def: "Ctrl+Shift+2", edit: true },
      { id: "calloutWarning", label: "Callout: warning", def: "Ctrl+Shift+3", edit: true },
      { id: "calloutTip", label: "Callout: tip", def: "", edit: true },
      { id: "calloutImportant", label: "Callout: important", def: "", edit: true },
      { id: "calloutCaution", label: "Callout: caution", def: "", edit: true },
      { id: "calloutInfo", label: "Callout: info", def: "", edit: true },
      { id: "pastePicture", label: "Paste picture from clipboard", def: "", edit: true },
      { id: "pictureOptions", label: "Picture options\u2026 (size, alignment)", def: "", edit: true },
      { id: "find", label: "Find in this note and other notes", def: "Ctrl+F" },
      { id: "remind", label: "Remind me about this note\u2026", def: "" },
      { id: "dateToday", label: "Open today's note", def: "" },
      { id: "dateTomorrow", label: "Open tomorrow's note", def: "" },
      { id: "dateNext", label: "Open the next work day's note", def: "" },
      { id: "dateList", label: "Notes by date\u2026", def: "" },
      { id: "outline", label: "Outline of this note (headings)\u2026", def: "" },
      { id: "history", label: "Version history of this note\u2026", def: "" },
      { id: "newNote", label: "New note", def: "Ctrl+N" },
      { id: "list", label: "All notes and search", def: "Ctrl+K" },
      { id: "mode", label: "Read / edit", def: "Ctrl+E" },
      { id: "split", label: "Split view", def: "" },
      { id: "settings", label: "Quick settings", def: "Ctrl+," },
      { id: "recent", label: "Recent notes", def: "" },
      { id: "notePin", label: "Pin note to the top of the list", def: "" },
      { id: "keepOpen", label: "Keep open / close on outside click", def: "" },
      { id: "larger", label: "Larger / smaller", def: "" },
      { id: "span", label: "Fill the whole area (both panels in Triple View)", def: "" },
      { id: "resetGeo", label: "Reset position and size", def: "" },
      // Global actions work anywhere in the window, also while Notes is closed.
      { id: "quickNew", label: "New note from anywhere", def: "", global: true },
      { id: "openFloating", label: "Open or close the standalone Notes card", def: "", global: true },
      { id: "captureQuick", label: "Add selected text to a note (default target)", def: "", global: true },
      { id: "captureInbox", label: "Add selected text to the Inbox note", def: "", global: true },
      { id: "capturePage", label: "Add this page (title and link) to a note", def: "", global: true },
    ]);
    const SHORTCUT_IDS = new Set(SHORTCUT_ACTIONS.map((a) => a.id));
    // Toolbar buttons and editor actions the person may hide (a hidden action has no button, no menu
    // entry and no shortcut). Quick settings is never hideable, so the way back always stays.
    const HIDEABLE_TOOLS = Object.freeze([
      ["bold", "Bold"], ["italic", "Italic"], ["strike", "Strikethrough"], ["highlight", "Highlight"], ["heading", "Heading"],
      ["bullet", "Bulleted list"], ["numbered", "Numbered list"], ["check", "Checklist"], ["quote", "Quote"],
      ["outdent", "Nest out"], ["indent", "Nest in"], ["rule", "Horizontal rule"], ["code", "Inline code"],
      ["codeBlock", "Code block"], ["link", "Link"], ["noteLink", "Link to another note"], ["image", "Image"], ["table", "Table"],
      ...CALLOUT_KINDS.map(([k, label]) => [calloutId(k), "Callout: " + label.toLowerCase()]),
      ["sup", "Superscript"], ["sub", "Subscript"], ["kbd", "Keyboard key"], ["footnote", "Footnote"], ["hubList", "Hub list of notes"],
    ]);
    const HIDEABLE_IDS = new Set(HIDEABLE_TOOLS.map((t) => t[0]));
    // Preference text "bold,sup" -> Set of valid ids (unknown words are ignored).
    const parseHidden = (raw) => new Set(String(raw ?? "").split(/[\s,;]+/).filter((x) => HIDEABLE_IDS.has(x)));
    const serializeHidden = (set) => HIDEABLE_TOOLS.map((t) => t[0]).filter((id) => set.has(id)).join(",");
    const GEO_KEYS = Object.freeze(["panel", "float", "dock"]); // hosts that remember a position and size
    function formatCombo(spec) {
      if (!spec || !spec.key) return "";
      const k = spec.key;
      const name = k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1);
      return [spec.ctrl && "Ctrl", spec.alt && "Alt", spec.shift && "Shift", spec.meta && "Meta", name].filter(Boolean).join("+");
    }
    const normalizeCombo = (text) => formatCombo(parseShortcut(text));
    // The combination a key press stands for, as the same canonical text ("" for a lone modifier).
    function comboFromEvent(e) {
      const raw = String(e.key || "");
      if (!raw || ["Control", "Shift", "Alt", "Meta", "AltGraph", "OS", "Dead"].includes(raw)) return "";
      let key = raw.length === 1 ? raw.toLowerCase() : raw;
      const code = String(e.code || "");
      if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase(); // same key on every layout
      else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
      if (key === " " || key === "Spacebar") key = "Space";
      return formatCombo({ ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey, meta: !!e.metaKey, key: key.toLowerCase() });
    }
    // The stored overrides, cleaned: unknown actions and combinations without a modifier are dropped.
    function parseShortcutMap(raw) {
      let obj = null;
      try {
        obj = JSON.parse(String(raw || ""));
      } catch (_) {}
      const out = {};
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
      for (const [id, v] of Object.entries(obj)) {
        if (!SHORTCUT_IDS.has(id) || typeof v !== "string") continue;
        if (v === "") out[id] = "";
        else {
          const c = normalizeCombo(v);
          if (c) out[id] = c;
        }
      }
      return out;
    }
    // [{ id, combo, spec }] for every action that has a shortcut after the overrides are applied.
    function effectiveShortcuts(overrides = {}) {
      const list = [];
      for (const a of SHORTCUT_ACTIONS) {
        const combo = Object.prototype.hasOwnProperty.call(overrides, a.id) ? overrides[a.id] : a.def;
        const spec = combo ? parseShortcut(combo) : null;
        if (spec) list.push({ id: a.id, combo: formatCombo(spec), spec });
      }
      return list;
    }
    const findShortcutConflict = (list, id, combo) => list.find((x) => x.id !== id && x.combo === combo)?.id || "";
    const matchShortcutAction = (e, list) => list.find((x) => matchesShortcut(e, x.spec))?.id || "";
    // What a new assignment does to the stored overrides (a value equal to the default is not stored).
    function assignShortcut(overrides, id, combo) {
      const next = { ...overrides };
      const def = SHORTCUT_ACTIONS.find((a) => a.id === id)?.def ?? "";
      if (combo === def) delete next[id];
      else next[id] = combo;
      return next;
    }

    // ======================================================================
    // Pure core: quick settings (the options a person changes while writing)
    // ======================================================================
    // Themes of the card (Appearance): "zentral" follows the Zen look, "recommended" copies the RSS card
    // (popup colours, solid surface, soft shadow), the rest are fixed palettes.
    const NOTE_THEMES = Object.freeze([
      ["zentral", "Zentral"],
      ["recommended", "Recommended"],
      ["light", "Light"],
      ["dark", "Dark"],
      ["paper", "Paper"],
    ]);
    const normalizeTheme = (v) => (NOTE_THEMES.some(([k]) => k === v) ? v : "zentral");
    // Every writing option. The Quick menu shows only the QUICK_IDS (the ones changed while writing); the
    // full Settings view shows all of them, so nothing is reachable only from the Zentral settings window.
    const WRITING_OPTIONS = Object.freeze([
      { id: "font", label: "Text size", pref: PREF.FONT_SIZE, kind: "step", min: 8, max: 40, step: 1, unit: "px", def: 13 },
      { id: "lineHeight", label: "Line height", pref: PREF.LINE_HEIGHT, kind: "step", min: 100, max: 300, step: 10, unit: "%", def: 160 },
      { id: "wrap", label: "Wrap long lines", pref: PREF.WRAP, kind: "bool", def: true },
      { id: "blank", label: "Blank lines in read view", pref: PREF.BLANK_LINES, kind: "choice", def: "collapse", choices: [["collapse", "Collapse"], ["keep", "Keep"]] },
      { id: "breaks", label: "Single line breaks", pref: PREF.LINE_BREAKS, kind: "choice", def: "break", choices: [["break", "Break"], ["join", "Join"]] },
      { id: "sync", label: "Linked scrolling in split view", meta: "syncScroll", kind: "bool", def: true },
      { id: "copy", label: "Select and copy text in read view", pref: PREF.READ_COPY, kind: "bool", def: false },
      { id: "paste", label: "Pasting a web address", pref: PREF.PASTE_LINK, kind: "choice", def: "ask", choices: [["ask", "Ask"], ["selection", "Over selection"], ["off", "As text"]] },
      { id: "setext", label: "Text over === or --- is a heading", pref: PREF.SETEXT, kind: "bool", def: false },
      { id: "theme", label: "Theme", pref: PREF.THEME, kind: "choice", def: "zentral", choices: NOTE_THEMES.map(([k, t]) => [k, t]) },
    ]);
    const QUICK_IDS = Object.freeze(["font", "lineHeight", "wrap", "blank", "breaks", "sync", "copy", "theme"]);
    const QUICK_OPTIONS = Object.freeze(WRITING_OPTIONS.filter((o) => QUICK_IDS.includes(o.id)));
    const stepOption = (opt, current, dir) => clampInt((Number(current) || opt.def) + dir * opt.step, opt.min, opt.max);

    // ---- colour maths for the in-app picker (hex <-> HSL, no native colour dialog: its popup counts as an
    // outside click and would close the sheet, like a native <select>) ---------------------------------
    function hexToHsl(hex) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
      if (!m) return null;
      const n = parseInt(m[1], 16);
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
      let hh = 0, ss = 0;
      if (d) {
        ss = d / (1 - Math.abs(2 * l - 1));
        hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        hh = (hh * 60 + 360) % 360;
      }
      return { h: Math.round(hh), s: Math.round(ss * 100), l: Math.round(l * 100) };
    }
    function hslToHex(h, s, l) {
      h = ((Number(h) % 360) + 360) % 360;
      s = Math.max(0, Math.min(100, Number(s))) / 100;
      l = Math.max(0, Math.min(100, Number(l))) / 100;
      const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
      const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
      return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
    }
    // "rgb(12, 34, 56)" / "rgba(...)" from getComputedStyle -> "#0c2238" (null when it is not opaque enough to use)
    function cssColorToHex(css) {
      const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(String(css ?? "").trim());
      if (!m) return null;
      if (m[4] !== undefined && Number(m[4]) === 0) return null;
      return "#" + [m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, "0")).join("");
    }
    // The full Settings view: tabs of items. kind: bool | choice | step (+/-) | slider (empty = theme) |
    // color (empty = theme) | text. Window items change in R2-R4; the tab list stays the one place to add one.
    const CAPTURE_STYLES = Object.freeze([["quote", "Quote"], ["plain", "Plain text"], ["bullet", "Bullet"], ["highlight", "Highlight"], ["callout", "Callout"]]);
    const CAPTURE_TARGETS = Object.freeze([["last", "Last open note"], ["new", "New note"], ["inbox", "Inbox note"]]);
    const L = (id, label, pref, min, max, unit, seed) => ({ id, label, pref, kind: "slider", min, max, unit, seed, theme: true });
    // A plain number slider: always has a value (no "Theme" reset), def is its default.
    const S = (id, label, pref, min, max, unit, def) => ({ id, label, pref, kind: "slider", min, max, unit, seed: def, def, plain: true });
    const C = (id, label, pref, seed) => ({ id, label, pref, kind: "color", seed, theme: true });
    const SETTINGS_TABS = Object.freeze([
      { id: "writing", label: "Writing", items: WRITING_OPTIONS },
      {
        id: "window", label: "Window", items: [
          { id: "dock", label: "Dock to the sidebar", pref: PREF.DOCK_SIDEBAR, kind: "bool", def: false },
          { id: "avoid", label: "Keep clear of the native sidebar (standalone card)", pref: PREF.AVOID_SIDEBAR, kind: "bool", def: true },
          { kind: "heading", label: "Push page" },
          { id: "push", label: "Push the page aside (standalone card only; a sheet in a panel always takes its own slot)", pref: PREF.PUSH_PAGE, kind: "bool", def: false },
          S("pushPct", "Share of the panel height the sheet takes", PREF.PUSH_PANEL_PERCENT, 20, 80, "%", 45),
          { kind: "heading", label: "Reveal strip" },
          { id: "strip", label: "Strip at the top of an open panel opens Notes on hover", pref: PREF.REVEAL_STRIP, kind: "bool", def: false },
          S("stripH", "Strip height", PREF.REVEAL_HEIGHT, 2, 24, "px", 10),
          S("stripD", "Hover delay", PREF.REVEAL_DELAY, 0, 1000, "ms", 100),
          { id: "hover", label: "Hide on an outside click instead of closing; bring back from the top edge", pref: PREF.HOVER_REVEAL, kind: "bool", def: false },
          { kind: "heading", label: "Split view" },
          S("widePct", "Width of the sheet in split view (100% = normal)", PREF.WIDE_PERCENT, 130, 300, "%", 200),
        ],
      },
      {
        id: "appearance", label: "Appearance", items: [
          { id: "theme2", label: "Theme (a starting point: every value below can override it)", pref: PREF.THEME, kind: "choice", def: "zentral", choices: NOTE_THEMES.map(([k, t]) => [k, t]) },
          { kind: "heading", label: "Shape" },
          L("radius", "Corner radius", PREF.LOOK_RADIUS, 0, 60, "px", 10),
          L("border", "Border width", PREF.LOOK_BORDER, 0, 8, "px", 1),
          L("padding", "Inner padding", PREF.LOOK_PADDING, 0, 64, "px", 12),
          L("opacity", "Background opacity", PREF.LOOK_OPACITY, 0, 100, "%", 100),
          { kind: "heading", label: "Shadow" },
          L("shBlur", "Blur", PREF.LOOK_SHADOW_BLUR, 0, 120, "px", 24),
          L("shY", "Offset down", PREF.LOOK_SHADOW_Y, 0, 60, "px", 6),
          L("shAlpha", "Strength (0 = none)", PREF.LOOK_SHADOW_ALPHA, 0, 100, "%", 28),
          { kind: "heading", label: "Text" },
          { id: "lookFont", label: "Font", pref: PREF.LOOK_FONT, kind: "choice", def: "auto", choices: [["auto", "Theme"], ["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"], ["rounded", "Rounded"]] },
          { id: "lookEditor", label: "Editor font", pref: PREF.LOOK_EDITOR_FONT, kind: "choice", def: "same", choices: [["same", "Same"], ["mono", "Mono"]] },
          C("heading", "Heading color", PREF.LOOK_HEADING, "text"),
          { kind: "heading", label: "Colors" },
          C("bg", "Background", PREF.LOOK_BG, "bg"),
          C("text", "Text", PREF.LOOK_TEXT, "text"),
          C("accent", "Accent (links, active items)", PREF.LOOK_ACCENT, "accent"),
          C("line", "Lines and border", PREF.LOOK_LINE, "text"),
          { kind: "heading", label: "Buttons" },
          L("btnSize", "Size", PREF.LOOK_BTN_SIZE, 14, 56, "px", 26),
          L("btnRadius", "Corner radius", PREF.LOOK_BTN_RADIUS, 0, 50, "px", 6),
          { id: "btnStyle", label: "Style", pref: PREF.LOOK_BTN_STYLE, kind: "choice", def: "plain", choices: [["plain", "Plain"], ["filled", "Filled"], ["outlined", "Outlined"]] },
          C("btnIcon", "Icon color", PREF.LOOK_BTN_ICON, "text"),
          C("btnFill", "Fill color", PREF.LOOK_BTN_FILL, "accent"),
          C("btnBorder", "Border color", PREF.LOOK_BTN_BORDER, "text"),
        ],
      },
      {
        id: "capture", label: "Capture", items: [
          { id: "capTarget", label: "Default target of the shortcuts", pref: PREF.CAPTURE_TARGET, kind: "choice", def: "last", choices: CAPTURE_TARGETS },
          { id: "capMenu", label: "Entry in the right-click menu", pref: PREF.CAPTURE_MENU, kind: "bool", def: true },
          { id: "capDate", label: "Include the date", pref: PREF.CAPTURE_DATE, kind: "bool", def: true },
          { id: "capTime", label: "Include the time", pref: PREF.CAPTURE_TIME, kind: "bool", def: false },
          { id: "capSource", label: "Include the page title", pref: PREF.CAPTURE_SOURCE, kind: "bool", def: true },
          { id: "capLink", label: "Link to the page", pref: PREF.CAPTURE_LINK, kind: "bool", def: true },
          { id: "capHl", label: "Link highlights the selection", pref: PREF.CAPTURE_HIGHLIGHT, kind: "bool", def: true },
          { id: "capCheck", label: "Start with a checkbox", pref: PREF.CAPTURE_CHECKBOX, kind: "bool", def: false },
          { id: "capStyle", label: "Style of the selected text", pref: PREF.CAPTURE_STYLE, kind: "choice", def: "quote", choices: CAPTURE_STYLES },
          { id: "capPos", label: "Where new entries go", pref: PREF.CAPTURE_POSITION, kind: "choice", def: "end", choices: [["end", "End"], ["top", "Top"]] },
          { id: "capOpen", label: "Open the note afterwards", pref: PREF.CAPTURE_OPEN, kind: "bool", def: false },
          { id: "capInbox", label: "Inbox note name", pref: PREF.CAPTURE_INBOX, kind: "text", def: "Inbox" },
        ],
      },
      {
        id: "links", label: "Links & history", items: [
          { id: "newChooser", label: "The + button asks: blank note, today, tomorrow or a date", pref: PREF.NEW_CHOOSER, kind: "bool", def: false },
          { id: "pinStrip", label: "Pinned notes strip and Recent menu under the title", pref: PREF.PIN_STRIP, kind: "bool", def: false },
          { id: "footerCount", label: "Footer shows characters and reading time (and counts the selection)", pref: PREF.FOOTER_COUNTER, kind: "bool", def: false },
          { id: "treeOrder", label: "Order in the notes tree", pref: PREF.TREE_ORDER, kind: "choice", def: "folders-first", choices: [["folders-first", "Folders first"], ["notes-first", "Notes first"], ["mixed-by-name", "Mixed, by name"]] },
          { id: "defaultView", label: "A panel opens in", pref: PREF.DEFAULT_VIEW, kind: "choice", def: "last", choices: [["last", "The view used last"], ["edit", "Editor"], ["read", "Preview"], ["split", "Split: editor and preview"]] },
          { id: "hubDesc", label: "Hub notes show a short description for each linked note", pref: PREF.HUB_DESC, kind: "bool", def: true },
          { id: "wikiAuto", label: "Suggest notes while typing [[", pref: PREF.WIKI_COMPLETE, kind: "bool", def: true },
          { id: "linkedStrip", label: "Show \"Linked from\" under the read view", pref: PREF.BACKLINKS_PANEL, kind: "bool", def: false },
          { id: "hiddenMenu", label: "Hidden tools stay reachable in More", pref: PREF.HIDDEN_MENU, kind: "bool", def: true },
          { id: "dateMode", label: "Date notes", pref: PREF.DATE_MODE, kind: "choice", def: "separate", choices: [["separate", "One note per day"], ["single", "All in one Journal note"]] },
          { kind: "heading", label: "Version history" },
          { id: "histOn", label: "Keep earlier versions", pref: PREF.HISTORY_ON, kind: "bool", def: true },
          S("histKeep", "Versions kept per note", PREF.HISTORY_KEEP, 1, 200, "", 20),
          S("histMin", "At most one version every", PREF.HISTORY_MINUTES, 1, 1440, "min", 10),
          S("histCap", "Do not version notes bigger than", PREF.HISTORY_CAP_KB, 16, 4096, "KB", 512),
          S("histWarn", "Warn when all history is bigger than", PREF.HISTORY_WARN_MB, 5, 2000, "MB", 100),
          { kind: "heading", label: "Performance" },
          { id: "findHl", label: "Find in a note shows matches by", pref: PREF.FIND_HL, kind: "choice", def: "selection", choices: [["selection", "Selecting the match"], ["backdrop", "Highlighting every match"]] },
          S("trashDays", "Delete notes from the Trash after (0 = never)", PREF.TRASH_DAYS, 0, 3650, "days", 30),
          { id: "spell", label: "Spell-check while typing", pref: PREF.SPELL, kind: "bool", def: true },
          S("spellMax", "Spell-check off in notes longer than", PREF.SPELL_MAX, 1000, 1000000, "chars", 100000),
        ],
      },
      {
        id: "zen", label: "Zen sidebar (experiment)", items: [
          { kind: "heading", label: "Experiment, off by default: not verified in a live Zen" },
          { id: "zenMode", label: "Show notes in Zen's pinned-tabs folder tree", pref: PREF.ZEN_MODE, kind: "choice", def: "off", choices: [["off", "Off"], ["selected", "Only Notes (tabbar)"], ["all", "Whole notes tree"]] },
          { id: "zenNewBtn", label: "Keep a \"New note\" entry once in the NOTES folder and in every subfolder (it creates the note in that folder)", pref: PREF.ZEN_NEW_BUTTON, kind: "bool", def: false },
          { id: "zenTop", label: "Put the NOTES folder at the top of the Pinned tabs when it is created", pref: PREF.ZEN_TOP, kind: "bool", def: true },
          { kind: "heading", label: "Diagnostics" },
          { id: "perf", label: "Sample layout / drag timings (read __zentralNotesPerf.report())", pref: PREF.DEBUG_PERF, kind: "bool", def: false },
        ],
      },
    ]);

    // ======================================================================
    // Pure core: appearance overrides (Notes appearance menu)
    // ======================================================================
    // Every option is "keep the theme" until the person picks a value. lookOverrides() turns the stored
    // values into CSS custom properties plus a list of flags; ZentralNotes.css has one rule per flag
    // (:root[zentral-notes-ov~="radius"] ...), so a theme that is left alone is never touched.
    const LOOK_HEX = /^#[0-9a-f]{6}$/i;
    const LOOK_FONTS = Object.freeze({
      sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
      mono: 'ui-monospace, "Cascadia Code", Consolas, Menlo, monospace',
      rounded: '"Segoe UI Variable Rounded", "Nunito", "Varela Round", system-ui, sans-serif',
    });
    const LOOK_VARS = Object.freeze([
      "radius", "border", "shadow", "opacity", "padding", "font", "editor-font", "heading", "btn-size",
      "btn-radius", "btn-icon", "btn-fill", "btn-border", "bg", "text", "accent", "line",
    ].map((n) => "--zentral-notes-ov-" + n));
    // get(prefName) -> stored text. Returns { vars: {name: value}, flags: [..] }; invalid values are ignored.
    function lookOverrides(get) {
      const vars = {}, flags = [];
      const put = (flag, name, value) => { vars["--zentral-notes-ov-" + name] = value; flags.push(flag); };
      const num = (pref, lo, hi) => {
        const raw = String(get(pref) ?? "auto").trim();
        if (!/^\d{1,3}$/.test(raw)) return null;
        const n = Number(raw);
        return n >= lo && n <= hi ? n : null;
      };
      const hex = (pref) => {
        const raw = String(get(pref) ?? "").trim();
        return LOOK_HEX.test(raw) ? raw.toLowerCase() : null;
      };
      let n;
      if ((n = num(PREF.LOOK_RADIUS, 0, 60)) !== null) put("radius", "radius", n + "px");
      if ((n = num(PREF.LOOK_BORDER, 0, 8)) !== null) put("border", "border", n + "px");
      // Shadow: blur, vertical offset and strength are independent; any one of them set builds the whole
      // shadow (the others fall back to a soft default), strength 0 means no shadow.
      const sb = num(PREF.LOOK_SHADOW_BLUR, 0, 120), sy = num(PREF.LOOK_SHADOW_Y, 0, 60), sa = num(PREF.LOOK_SHADOW_ALPHA, 0, 100);
      if (sb !== null || sy !== null || sa !== null) {
        const alpha = sa === null ? 28 : sa;
        put("shadow", "shadow", alpha === 0 ? "none" : `0 ${sy === null ? 6 : sy}px ${sb === null ? 24 : sb}px rgba(0, 0, 0, ${(alpha / 100).toFixed(2)})`);
      }
      if ((n = num(PREF.LOOK_OPACITY, 0, 100)) !== null) put("opacity", "opacity", n + "%");
      if ((n = num(PREF.LOOK_PADDING, 0, 64)) !== null) put("padding", "padding", n + "px");
      const font = String(get(PREF.LOOK_FONT) ?? "auto");
      if (LOOK_FONTS[font]) put("font", "font", LOOK_FONTS[font]);
      if (String(get(PREF.LOOK_EDITOR_FONT) ?? "same") === "mono") put("editor-font", "editor-font", LOOK_FONTS.mono);
      let c;
      if ((c = hex(PREF.LOOK_HEADING))) put("heading", "heading", c);
      if ((n = num(PREF.LOOK_BTN_SIZE, 14, 56)) !== null) put("btn-size", "btn-size", n + "px");
      if ((n = num(PREF.LOOK_BTN_RADIUS, 0, 50)) !== null) put("btn-radius", "btn-radius", n + "px");
      const style = String(get(PREF.LOOK_BTN_STYLE) ?? "plain");
      if (style === "filled" || style === "outlined") flags.push("btn-" + style);
      if ((c = hex(PREF.LOOK_BTN_ICON))) put("btn-icon", "btn-icon", c);
      if ((c = hex(PREF.LOOK_BTN_FILL))) put("btn-fill", "btn-fill", c);
      if ((c = hex(PREF.LOOK_BTN_BORDER))) put("btn-border", "btn-border", c);
      if ((c = hex(PREF.LOOK_BG))) put("bg", "bg", c);
      if ((c = hex(PREF.LOOK_TEXT))) put("text", "text", c);
      if ((c = hex(PREF.LOOK_ACCENT))) put("accent", "accent", c);
      if ((c = hex(PREF.LOOK_LINE))) put("line", "line", c);
      return { vars, flags };
    }

    // ======================================================================
    // Pure core: capture (selected text or page -> a snippet in a note)
    // ======================================================================
    const CAPTURE_MAX_CHARS = 8000;
    const CAPTURE_STYLE_IDS = new Set(CAPTURE_STYLES.map((s) => s[0]));
    const CAPTURE_DEFAULTS = Object.freeze({ date: true, time: false, source: true, link: true, highlight: true, checkbox: false, style: "quote", position: "end" });
    const cleanCaptureText = (raw) =>
      String(raw ?? "").replace(/\0/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, CAPTURE_MAX_CHARS).trim();
    // Page address without its #fragment plus a text-fragment directive that names the selection, so the
    // link opens the page scrolled to the words and highlighted (Firefox "link to highlight" syntax).
    function captureFragmentUrl(url, text) {
      const base = String(url ?? "").split("#")[0];
      const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
      if (!base || !words.length) return base;
      const enc = (s) => encodeURIComponent(s).replace(/[-,&]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
      const spec = words.length <= 8 ? enc(words.join(" ")) : enc(words.slice(0, 4).join(" ")) + "," + enc(words.slice(-4).join(" "));
      return base + "#:~:text=" + spec;
    }
    const pad2 = (n) => String(n).padStart(2, "0");
    const captureDate = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); };
    const captureTime = (ms) => { const d = new Date(ms); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
    function captureStyleLines(text, style) {
      const lines = text.split("\n");
      switch (style) {
        case "quote": return lines.map((l) => (l ? "> " + l : ">"));
        case "bullet": return lines.map((l, i) => (i === 0 ? "- " : "  ") + l);
        case "highlight": return ["==" + text.replace(/\s*\n\s*/g, " ").replace(/==/g, "= =") + "=="];
        case "callout": return ["> [!NOTE]", ...lines.map((l) => (l ? "> " + l : ">"))];
        default: return lines;
      }
    }
    // { text, title, url, now, opts } -> Markdown snippet (no trailing newline). A page without selected
    // text becomes a single source line.
    function buildCapture({ text = "", title = "", url = "", now = Date.now(), opts = {} } = {}) {
      const o = { ...CAPTURE_DEFAULTS, ...opts };
      if (!CAPTURE_STYLE_IDS.has(o.style)) o.style = "quote";
      const body = cleanCaptureText(text);
      const label = String(title ?? "").replace(/\s+/g, " ").trim();
      const safe = url && safeHref(url, false) ? String(url) : "";
      const meta = [];
      if (o.date) meta.push(captureDate(now));
      if (o.time) meta.push(captureTime(now));
      let host = "";
      try { host = new URL(safe).host; } catch (_) { host = ""; }
      const sourceText = o.source ? label || host : "";
      if (o.link && safe) {
        const href = o.highlight && body ? captureFragmentUrl(safe, body) : safe;
        meta.push(buildLink(sourceText || label || host || safe, href));
      } else if (sourceText) meta.push(sourceText.replace(/\n/g, " "));
      const head = meta.join(" \u00b7 ");
      const one = body.replace(/\s*\n\s*/g, " ");
      if (!body) return o.checkbox && head ? "- [ ] " + head : head;
      if (o.checkbox) {
        if (!head) return "- [ ] " + (o.style === "highlight" ? "==" + one.replace(/==/g, "= =") + "==" : one);
        return ["- [ ] " + head, "", ...captureStyleLines(body, o.style)].join("\n");
      }
      return (head ? [head, "", ...captureStyleLines(body, o.style)] : captureStyleLines(body, o.style)).join("\n");
    }
    // Put a snippet into a note body: at the end, or at the top (below a first "# Title" line if there is one).
    function insertCapture(body, snippet, position = "end") {
      const b = String(body ?? "");
      const s = String(snippet ?? "").replace(/\s+$/, "");
      if (!s) return b;
      if (!b.trim()) return s + "\n";
      if (position === "top") {
        const m = /^(# [^\n]*\n)\n*/.exec(b);
        return m ? m[1] + "\n" + s + "\n\n" + b.slice(m[0].length) : s + "\n\n" + b;
      }
      return b.replace(/\s+$/, "") + "\n\n" + s + "\n";
    }
    // The inbox is the first live note whose label equals the configured name (case-insensitive).
    const findInbox = (notes, name) => {
      const want = cleanLabel(name || "Inbox").toLowerCase();
      return (notes || []).find((n) => !n.trashed && String(n.label || "").toLowerCase() === want) || null;
    };

    // ======================================================================
    // Pure core: find in notes (P2). Matching rules, in one place:
    //  - literal text, never a regular expression; the query is trimmed, capped at FIND_MAX_QUERY and an
    //    empty query matches nothing; a multi-word query is one phrase, not several words;
    //  - case-insensitive and accent-insensitive ("zolc" finds "Żółć"); folding keeps every character the
    //    same length, so match offsets stay valid in the original text;
    //  - matches never overlap; at most FIND_MAX_MATCHES are reported per text;
    //  - "other notes" = non-trashed notes except the current one whose text or label contains the phrase.
    // ======================================================================
    const FIND_MAX_QUERY = 200;
    const FIND_MAX_MATCHES = 2000;
    const FIND_MAX_SCAN = 400000; // characters scanned per note when counting other notes
    const FOLD_EXTRA = Object.freeze({ "\u0142": "l", "\u0141": "l", "\u00f8": "o", "\u00d8": "o", "\u0111": "d", "\u0110": "d", "\u00df": "s" });
    const COMBINING_TAIL_RE = /^[^\u0300-\u036f][\u0300-\u036f]+$/;
    function foldChar(ch) {
      if (ch.length !== 1) return ch;
      if (FOLD_EXTRA[ch]) return FOLD_EXTRA[ch];
      const lower = ch.toLowerCase();
      const base = lower.length === 1 ? lower : ch;
      const d = base.normalize("NFD");
      return d.length > 1 && COMBINING_TAIL_RE.test(d) ? d[0] : base;
    }
    function foldText(s) {
      s = String(s ?? "");
      let out = "";
      for (let i = 0; i < s.length; i++) out += foldChar(s[i]);
      return out;
    }
    const normalizeFindQuery = (q) => String(q ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, FIND_MAX_QUERY).trim();
    function findMatches(text, query, limit = FIND_MAX_MATCHES) {
      const q = foldText(normalizeFindQuery(query));
      if (!q) return [];
      const hay = foldText(text);
      const out = [];
      for (let at = hay.indexOf(q); at !== -1 && out.length < limit; at = hay.indexOf(q, at + q.length))
        out.push({ start: at, end: at + q.length });
      return out;
    }
    // Rendered text arrives as separate runs (one per text node). A match never spans two runs.
    // Pieces of `text` for the highlight layer: [{ text, hit: false|index }]. Matches are sorted and non-overlapping.
    function highlightSegments(text, matches) {
      const out = [];
      let at = 0;
      matches.forEach((m, i) => {
        if (m.start < at || m.end <= m.start) return;
        if (m.start > at) out.push({ text: text.slice(at, m.start), hit: false });
        out.push({ text: text.slice(m.start, m.end), hit: i });
        at = m.end;
      });
      if (at < text.length) out.push({ text: text.slice(at), hit: false });
      return out;
    }
    function findInRuns(runs, query, limit = FIND_MAX_MATCHES) {
      const out = [];
      for (let i = 0; i < runs.length && out.length < limit; i++)
        for (const m of findMatches(runs[i], query, limit - out.length)) out.push({ run: i, start: m.start, end: m.end });
      return out;
    }
    function searchOtherNotes(notes, query, currentId = "") {
      const q = foldText(normalizeFindQuery(query));
      if (!q) return { query: "", count: 0, ids: [] };
      const hits = [];
      for (const n of notes) {
        if (!n || n.trashed || n.id === currentId) continue;
        if (foldText(String(n.body ?? "").slice(0, FIND_MAX_SCAN)).includes(q) || foldText(n.label || "").includes(q)) hits.push(n);
      }
      hits.sort((a, b) => b.updated - a.updated);
      return { query: normalizeFindQuery(query), count: hits.length, ids: hits.map((n) => n.id) };
    }
    // Next (dir 1) or previous (dir -1) match index with wrap-around; nothing selected yet = -1.
    function stepMatchIndex(current, total, dir = 1) {
      if (!(total > 0)) return -1;
      if (!(current >= 0 && current < total)) return dir < 0 ? total - 1 : 0;
      return (current + (dir < 0 ? -1 : 1) + total) % total;
    }
    // First match at or after the caret (so a search starts where the person is writing), wrapping to 0.
    function firstMatchFrom(matches, caret) {
      const i = matches.findIndex((m) => m.end > caret);
      return matches.length ? (i < 0 ? 0 : i) : -1;
    }
    const lineOfOffset = (text, offset) => {
      let n = 0;
      for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) n++;
      return n;
    };
    // New scrollTop that reveals an item, or null when it is already comfortably inside the view.
    function revealScroll({ y = 0, h = 0, top = 0, height = 0, margin = 24 } = {}) {
      if (!(height > 0)) return null;
      if (y - margin >= top && y + h + margin <= top + height) return null;
      return Math.max(0, Math.round(y - height / 3));
    }

    // ======================================================================
    // Pure core: pasted pictures and the per-note asset folder (P2)
    //  - files live in <notes folder>/assets/<note id>/<generated name>; nothing else is ever read or written;
    //  - the .md keeps ordinary Markdown: ![alt](assets/<id>/<file>#w=320&a=center). The fragment (width,
    //    alignment) is ignored by other Markdown tools, which still show the picture;
    //  - only PNG, JPEG, GIF and WebP (no SVG: it can carry script); the type is checked from the file's own
    //    first bytes, not from the clipboard's claim; nothing is ever fetched from a network address.
    // ======================================================================
    const ASSET_DIR = "assets";
    const ASSET_MAX_BYTES = 5 * 1024 * 1024;
    const ASSET_MAX_PER_NOTE = 200;
    const ASSET_MIME = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" });
    const ASSET_EXT_MIME = Object.freeze({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" });
    const ASSET_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,119}$/;
    const ASSET_LINK_RE = /^assets\/([A-Za-z0-9_][A-Za-z0-9_-]{0,119})\/([A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|jpe?g|gif|webp))(?:#([A-Za-z0-9=&]{0,40}))?$/i;
    const ASSET_ALIGNS = Object.freeze(["left", "center", "right"]);
    const ASSET_W_MIN = 16, ASSET_W_MAX = 2000;
    const isAssetNoteId = (id) => ASSET_ID_RE.test(String(id ?? ""));
    function sniffImageMime(bytes) {
      const b = bytes || [];
      if (b.length < 12) return "";
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
      if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
      if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
      return "";
    }
    // Checks a clipboard/file candidate: { ok, mime, ext, reason }.
    function checkAssetBytes(bytes, claimedMime = "") {
      const len = bytes ? bytes.length : 0;
      if (!len) return { ok: false, reason: "empty" };
      if (len > ASSET_MAX_BYTES) return { ok: false, reason: "too-big" };
      const mime = sniffImageMime(bytes);
      if (!mime || !ASSET_MIME[mime]) return { ok: false, reason: "type" };
      if (claimedMime && claimedMime !== mime) return { ok: false, reason: "mismatch" };
      return { ok: true, mime, ext: ASSET_MIME[mime] };
    }
    function assetFileName(ext, now = Date.now(), rnd = Math.random) {
      const d = new Date(now);
      const stamp = d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + "-" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds());
      return "img-" + stamp + "-" + Math.floor(rnd() * 36 ** 3).toString(36).padStart(3, "0") + "." + (ASSET_MIME[ASSET_EXT_MIME[ext]] || "png");
    }
    const assetRel = (noteId, file) => ASSET_DIR + "/" + noteId + "/" + file;
    // "assets/<id>/<file>#w=320&a=center" -> { rel, noteId, file, mime, width, align } or null.
    function parseAssetLink(src) {
      const m = ASSET_LINK_RE.exec(String(src ?? ""));
      if (!m) return null;
      const out = { rel: ASSET_DIR + "/" + m[1] + "/" + m[2], noteId: m[1], file: m[2], mime: ASSET_EXT_MIME[m[3].toLowerCase()], width: 0, align: "" };
      for (const part of (m[4] || "").split("&")) {
        const [k, v] = part.split("=");
        if (k === "w" && /^\d{1,4}$/.test(v || "")) {
          const w = Number(v);
          if (w >= ASSET_W_MIN && w <= ASSET_W_MAX) out.width = w;
        } else if (k === "a" && ASSET_ALIGNS.includes(v)) out.align = v;
      }
      return out;
    }
    function buildAssetLink(rel, { width = 0, align = "" } = {}) {
      const parts = [];
      const w = Math.round(Number(width));
      if (w >= ASSET_W_MIN && w <= ASSET_W_MAX) parts.push("w=" + w);
      if (ASSET_ALIGNS.includes(align)) parts.push("a=" + align);
      return rel + (parts.length ? "#" + parts.join("&") : "");
    }
    const buildAssetImage = (alt, rel, opts) => "![" + String(alt ?? "").replace(/[\[\]\n]/g, " ").trim() + "](" + buildAssetLink(rel, opts) + ")";
    // Inserts the picture as its own paragraph at the selection.
    function insertAssetImage(value, s, e, alt, rel, opts) {
      const md = buildAssetImage(alt, rel, opts);
      const before = value.slice(0, s), after = value.slice(e);
      const lead = before && !before.endsWith("\n") ? "\n\n" : before.endsWith("\n\n") || !before ? "" : "\n";
      const tail = after && !after.startsWith("\n") ? "\n\n" : after.startsWith("\n\n") || !after ? "" : "\n";
      const text = lead + md + tail;
      const at = s + lead.length + md.length;
      return { start: s, end: e, text, selStart: at, selEnd: at };
    }
    const ASSET_IMG_RE = /!\[([^\]\n]*)\]\((assets\/[^\s)]+)\)/g;
    // The picture link under the caret (or null): { start, end, alt, link }.
    function assetImageAt(value, caret) {
      ASSET_IMG_RE.lastIndex = 0;
      for (let m = ASSET_IMG_RE.exec(value); m; m = ASSET_IMG_RE.exec(value)) {
        const link = parseAssetLink(m[2]);
        if (link && caret >= m.index && caret <= m.index + m[0].length) return { start: m.index, end: m.index + m[0].length, alt: m[1], link };
      }
      return null;
    }
    // New alignment / width for the picture under the caret; width 0 = original size, align "" = none.
    function restyleAssetImage(value, caret, opts) {
      const hit = assetImageAt(value, caret);
      if (!hit) return null;
      const md = buildAssetImage(hit.alt, hit.link.rel, opts);
      return { start: hit.start, end: hit.end, text: md, selStart: hit.start + md.length, selEnd: hit.start + md.length };
    }
    // Every asset file a body refers to, so a cleanup could tell what is still used.
    function assetRefs(body) {
      const out = new Set();
      ASSET_IMG_RE.lastIndex = 0;
      for (let m = ASSET_IMG_RE.exec(String(body ?? "")); m; m = ASSET_IMG_RE.exec(String(body ?? ""))) {
        const link = parseAssetLink(m[2]);
        if (link) out.add(link.rel);
      }
      return out;
    }

    // ======================================================================
    // Pure core: reminders (P2)
    //  - per note, front matter: `remind: <ISO time>` (whole minutes; seconds are always 0) and `reminded: <ISO time>` = the due time
    //    that was already announced, so a restart or a second window never announces it again;
    //  - one coarse timer for the next due reminder (no polling); dueReminders = overdue and not yet announced.
    // ======================================================================
    // Whole minutes: typing 16:43 rings at 16:43 (the old 5-minute snap was a lie, Cycle F #15). The timer below is armed
    // for the exact due time, so there is no tick to speed up.
    const REMIND_STEP_MS = 60 * 1000;
    const REMIND_MIN = Date.UTC(2000, 0, 1), REMIND_MAX = Date.UTC(2100, 0, 1);
    const MAX_TIMER_MS = 2 ** 31 - 1;
    const SNOOZE_CHOICES = Object.freeze([[10, "10 minutes"], [60, "1 hour"], [180, "3 hours"], [1440, "Tomorrow"]]);
    // Nearest whole minute (seconds dropped); 0 for anything that is not a sensible time.
    function cleanRemind(v) {
      const t = Number(v);
      if (!Number.isFinite(t) || t < REMIND_MIN || t > REMIND_MAX) return 0;
      return Math.round(t / REMIND_STEP_MS) * REMIND_STEP_MS;
    }
    const ceilStep = (t) => Math.ceil(t / REMIND_STEP_MS) * REMIND_STEP_MS;
    const reminderPending = (n) => !!n && !n.trashed && n.remind > 0 && !(n.reminded >= n.remind);
    function dueReminders(notes, now) {
      return notes.filter((n) => reminderPending(n) && n.remind <= now).sort((a, b) => a.remind - b.remind || (a.id < b.id ? -1 : 1));
    }
    function nextReminderAt(notes, now) {
      let best = 0;
      for (const n of notes) if (reminderPending(n) && n.remind > now && (!best || n.remind < best)) best = n.remind;
      return best;
    }
    const reminderDelay = (at, now) => Math.max(0, Math.min(MAX_TIMER_MS, at - now));
    // Quick choices for the reminder dialog, computed from the local clock (tomorrow = 09:00 local).
    function reminderPresets(now) {
      const d = new Date(now);
      const at = (days, hh) => cleanRemind(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hh, 0, 0).getTime());
      const out = [["In 1 hour", ceilStep(now + 3600000)]];
      if (at(0, 18) > now + REMIND_STEP_MS) out.push(["This evening (18:00)", at(0, 18)]);
      out.push(["Tomorrow (09:00)", at(1, 9)]);
      out.push(["Next week (Mon 09:00)", at(((8 - d.getDay()) % 7) || 7, 9)]);
      return out;
    }
    const pad4 = (n) => String(n).padStart(4, "0");
    const remindDateText = (t) => { const d = new Date(t); return pad4(d.getFullYear()) + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); };
    const remindTimeText = (t) => { const d = new Date(t); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
    // Live line under the reminder inputs: "Will ring at 16:43 (in 12 min)". `at` = parseRemindInput result (0 = unreadable).
    function remindPreview(at, now) {
      if (!at) return "Enter the date as YYYY-MM-DD and the time as HH:MM";
      if (at <= now) return "That time has already passed";
      const mins = Math.ceil((at - now) / 60000);
      const left = mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.floor(mins / 60)} h${mins % 60 ? " " + (mins % 60) + " min" : ""}` : `${Math.round(mins / 1440)} days`;
      const sameDay = remindDateText(at) === remindDateText(now);
      return `Will ring at ${sameDay ? "" : remindDateText(at) + " "}${remindTimeText(at)} (in ${left})`;
    }
    // "2026-11-02" + "09:05" (local time) -> time or 0. Seconds are not accepted; the minute is kept as typed.
    function parseRemindInput(dateText, timeText) {
      const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText).trim()), tm = /^(\d{1,2}):(\d{2})$/.exec(String(timeText).trim());
      if (!dm || !tm) return 0;
      const [y, mo, da, hh, mi] = [dm[1], dm[2], dm[3], tm[1], tm[2]].map(Number);
      if (mo < 1 || mo > 12 || da < 1 || da > 31 || hh > 23 || mi > 59) return 0;
      const d = new Date(y, mo - 1, da, hh, mi, 0, 0);
      if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return 0;
      return cleanRemind(d.getTime());
    }
    // One timer, armed for the next future reminder. `onDue(notes)` receives every overdue, unannounced
    // reminder as one batch AFTER the store has recorded them as announced (claim), so nothing repeats.
    function createReminderScheduler({ store, now = () => Date.now(), setTimer, clearTimer, onDue }) {
      let timer = null, destroyed = false, busy = false, again = false;
      const stop = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
      async function pass() {
        if (destroyed) return;
        if (busy) { again = true; return; }
        busy = true;
        try {
          do {
            again = false;
            stop();
            const notes = store.list({ trashed: false });
            const fired = [];
            for (const n of dueReminders(notes, now())) {
              if (destroyed) return;
              if (await store.claimReminder(n.id)) fired.push(n);
            }
            if (destroyed) return;
            if (fired.length) { try { onDue(fired.map((n) => store.get(n.id) || n)); } catch (_) {} }
            const next = nextReminderAt(store.list({ trashed: false }), now());
            if (next && !destroyed) timer = setTimer(() => { timer = null; run(); }, reminderDelay(next, now()));
          } while (again && !destroyed);
        } finally { busy = false; }
      }
      const run = () => pass().catch(() => {});
      const off = store.on((ev) => {
        if (destroyed) return;
        if (ev.type === "reset" || ev.type === "remove" || (ev.type === "change" && (ev.reminder || ev.meta || ev.remote || ev.created))) run();
      });
      return {
        start: run,
        reschedule: run,
        pending: () => timer !== null,
        destroy() { if (destroyed) return; destroyed = true; stop(); off(); },
      };
    }

    // ======================================================================
    // Pure core: window geometry (drag, resize, stay inside the area), hold-to-act, recent list
    // ======================================================================
    // Rectangles are {x, y, w, h} in pixels, local to an area {w, h} (the page area of a panel, or the
    // window for the standalone card). Nothing here touches the DOM, so every rule is unit-tested.
    const GEO_MIN = Object.freeze({ w: 240, h: 160 });
    const RESIZE_HANDLES = Object.freeze(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);
    const isNum = (v) => typeof v === "number" && Number.isFinite(v);
    // A stored rectangle, cleaned: whole pixels and a sane size, otherwise null (= use the default place).
    function normalizeGeo(raw) {
      if (!raw || typeof raw !== "object") return null;
      const { x, y, w, h } = raw;
      if (![x, y, w, h].every(isNum)) return null;
      if (w < GEO_MIN.w || h < GEO_MIN.h || w > 20000 || h > 20000 || Math.abs(x) > 40000 || Math.abs(y) > 40000) return null;
      return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    }
    // Pull a rectangle back inside the area. It keeps the minimum size unless the area itself is smaller.
    function clampGeo(rect, area, min = GEO_MIN) {
      const aw = Math.max(1, area.w), ah = Math.max(1, area.h);
      const w = Math.min(Math.max(rect.w, Math.min(min.w, aw)), aw);
      const h = Math.min(Math.max(rect.h, Math.min(min.h, ah)), ah);
      return {
        x: Math.round(Math.min(Math.max(rect.x, 0), aw - w)),
        y: Math.round(Math.min(Math.max(rect.y, 0), ah - h)),
        w: Math.round(w),
        h: Math.round(h),
      };
    }
    const moveGeo = (start, dx, dy, area) => clampGeo({ ...start, x: start.x + dx, y: start.y + dy }, area);
    // Drag one edge or corner: a west / north edge moves the origin, the opposite edge stays where it is.
    function resizeGeo(start, handle, dx, dy, area, min = GEO_MIN) {
      let left = start.x, top = start.y, right = start.x + start.w, bottom = start.y + start.h;
      const has = (c) => String(handle).includes(c);
      if (has("w")) left = Math.min(Math.max(left + dx, 0), right - min.w);
      if (has("e")) right = Math.max(Math.min(right + dx, area.w), left + min.w);
      if (has("n")) top = Math.min(Math.max(top + dy, 0), bottom - min.h);
      if (has("s")) bottom = Math.max(Math.min(bottom + dy, area.h), top + min.h);
      return clampGeo({ x: left, y: top, w: right - left, h: bottom - top }, area, min);
    }
    // Where the sheet goes inside `area` ({width, height, anchor}); the result is local to the area.
    // size: "peek" (a part of the area), "full" (all of it), "span" (all of the widest area, see the adapters).
    // A stored `geo` replaces only the peek size.
    function placeSheet({ area, size = "peek", geo = null, margin = 6 }) {
      const m = margin, aw = area.width, ah = area.height;
      const full = size === "full" || size === "span" || ah < 320;
      if (geo && !full) return clampGeo(geo, { w: aw, h: ah });
      const w = Math.max(200, aw - m * 2);
      const hgt = full ? Math.max(120, ah - m * 2) : Math.min(ah - m * 2, Math.max(280, Math.round(ah * 0.62)));
      return { x: m, y: area.anchor === "bottom" ? ah - m - hgt : m, w, h: hgt };
    }
    // How far the page must move aside for a card at [left, left+width] so it does not cover the page.
    // `content` is the page's un-pushed rectangle. Null = do not push (card wider than 60% of the page,
    // or it does not touch either edge of the page).
    function pushAmount({ left, width }, content, gap = 8) {
      const cw = content.right - content.left;
      if (!(width > 0) || !(cw > 0) || width > cw * 0.6) return null;
      const center = left + width / 2;
      if (center > (content.left + content.right) / 2) {
        const px = Math.round(content.right - left + gap);
        return px > 0 && px <= cw * 0.7 ? { side: "right", px } : null;
      }
      const px = Math.round(left + width - content.left + gap);
      return px > 0 && px <= cw * 0.7 ? { side: "left", px } : null;
    }
    // ---- slot model (a panel-hosted sheet is a band of the panel's layout, not an overlay) -------------
    // `share` = the fraction of the panels' page height the sheet takes. Pure maths so it can be tested.
    const SLOT_MIN_SHARE = 0.15, SLOT_MAX_SHARE = 0.85, SLOT_LARGE_SHARE = 0.8, SLOT_MIN_PX = 140, SLOT_PAGE_MIN_PX = 120, GAP_PANEL_MIN_PX = 120;
    const clampShare = (v) => (Number.isFinite(v) ? Math.max(SLOT_MIN_SHARE, Math.min(SLOT_MAX_SHARE, v)) : 0);
    // size peek = the remembered / preferred share, full = a big share, span = no slot at all (overlay fills the area).
    function slotShare({ size = "peek", pref = 45, custom = 0 } = {}) {
      if (size === "span") return 0;
      const own = Number(custom) > 0 ? clampShare(Number(custom)) : 0;
      const base = own > 0 ? own : clampShare(Number(pref) / 100) || 0.45;
      return size === "full" ? Math.max(base, SLOT_LARGE_SHARE) : base;
    }
    // Height in px for a share of `base`: never below a usable sheet, never leaving the pages less than a strip.
    function clampSlotPx(base, px) {
      if (!(base > 200) || !(px > 0)) return 0;
      const lo = Math.min(SLOT_MIN_PX, Math.round(base * 0.5)), hi = Math.max(lo, base - SLOT_PAGE_MIN_PX);
      return Math.max(lo, Math.min(hi, Math.round(px)));
    }
    function slotPx(base, share) {
      if (!(base > 200) || !(share > 0)) return 0;
      return clampSlotPx(base, base * share);
    }
    // Between Triple View's web panels the Notes sheet has TWO independent edges. Its top edge moves the upper
    // panel's boundary (only `up` changes, `down` stays), its bottom edge moves the lower panel's boundary
    // (only `down` changes). Pure and clamped so a drag can never drift or leave either panel unusable.
    // `dy` is the pointer travel since the gesture began; every call restarts from the gesture's START values,
    // so repeated moves do not accumulate.
    // `roomUp` / `roomDown` = how much more the upper / lower web panel can give before it falls below a usable
    // height (a panel under ~40px is no longer counted as a page at all, which collapsed the slot mid-drag).
    function gapEdgeDrag({ edge = "n", startUp = 0, startDown = 0, dy = 0, base = 0, roomUp = Infinity, roomDown = Infinity } = {}) {
      const su = Math.max(0, Number(startUp) || 0), sd = Math.max(0, Number(startDown) || 0);
      if (!(base > 200)) return { up: su, down: sd, px: su + sd };
      const lo = Math.min(SLOT_MIN_PX, Math.round(base * 0.5)), hi = Math.max(lo, base - SLOT_PAGE_MIN_PX);
      let up = su, down = sd;
      if (edge === "n") up = Math.min(Math.max(0, su - dy), su + Math.max(0, roomUp));
      else if (edge === "s") down = Math.min(Math.max(0, sd + dy), sd + Math.max(0, roomDown));
      // Never beyond the allowed total: the edge being dragged stops, the other edge stays where it was.
      if (up + down > hi) { if (edge === "n") up = Math.max(0, hi - down); else down = Math.max(0, hi - up); }
      if (up + down < lo) { if (edge === "n") up = Math.max(0, lo - down); else down = Math.max(0, lo - up); }
      return { up: Math.round(up), down: Math.round(down), px: Math.round(up) + Math.round(down) };
    }
    // A panel stretched from the top of the content area to the bottom of the window has nothing left to give:
    // Notes must not reserve height from it. `reserve` (docked Notes' own margin) is added back so the answer
    // does not flip once the reserve has shortened the panel. There is no dedicated attribute for this state in the
    // panel code (Expand is width-only), so it is measured from the real geometry.
    function panelSpansFullHeight({ top = 0, bottom = 0, reserve = 0, areaTop = 0, windowHeight = 0, tol = 4 } = {}) {
      if (!(windowHeight > 0) || !(bottom > top)) return false;
      return top <= areaTop + tol && bottom + Math.max(0, reserve) >= windowHeight - tol;
    }
    // Where a docked band starts: below the whole panel (URL bar included), never merely below its pages.
    function dockBandTop({ pageBottom = 0, panelBottom = NaN } = {}) {
      return Number.isFinite(panelBottom) ? Math.max(pageBottom, panelBottom) : pageBottom;
    }
    // The panel's page rectangles exclude a bottom reserve, but Triple View's gap sits inside their union.
    // Convert the measured page span back to the original available height without double-counting the gap.
    function pagesWithoutSlotHeight({ pageHeight = 0, slotPx: reserved = 0, slotKind = "" } = {}) {
      const h = Math.max(0, Number(pageHeight) || 0);
      return slotKind === "gap" ? h : h + Math.max(0, Number(reserved) || 0);
    }
    // Dragging an edge of a slot sheet: `dir` -1 = the top edge (dragging up grows it), +1 = the bottom edge.
    function slotDragShare({ startPx, base, dy, dir = -1 }) {
      if (!(base > 200)) return 0;
      return clampShare((startPx + (dir < 0 ? -dy : dy)) / base);
    }
    // After the panel is switched or rebuilt Notes comes back where it was: the bar of the same kind, or the
    // main panel bar when the Triple View bottom bar is gone. "" = nowhere to go (yet).
    function followTarget({ want = "", kinds = [], triple = false } = {}) {
      if (!want) return "";
      if (kinds.includes(want)) return want;
      if (want === "triple" && !triple && kinds.includes("primary")) return "primary";
      return "";
    }
    // The part of `bounds` left when tall strips at its left or right edge (the native sidebar) are taken
    // out. Short or small rectangles are ignored; at least `minWidth` always remains.
    function keepClear(bounds, rects, viewHeight, minWidth = 240) {
      let left = bounds.left, right = bounds.left + bounds.width;
      const mid = bounds.left + bounds.width / 2;
      for (const r of rects || []) {
        if (!r || !(r.width >= 20) || !(r.height >= viewHeight * 0.4)) continue;
        if (r.left + r.width / 2 < mid) left = Math.max(left, Math.min(r.left + r.width, right - minWidth));
        else right = Math.min(right, Math.max(r.left, left + minWidth));
      }
      return { left, top: bounds.top, width: right - left, height: bounds.height };
    }
    // V4-R3: a sheet that spills over the page must not cover a small control (the panel pill menu). If `rect`
    // overlaps the box, the box loses the part on the pill's side; at least `minWidth` always remains.
    function clearOfRect(box, rect, minWidth = 240) {
      if (!box || !rect || !(rect.width > 0) || !(rect.height > 0)) return box;
      const right = box.left + box.width, rr = rect.left + rect.width;
      const vOverlap = rect.top < box.top + box.height && rect.top + rect.height > box.top;
      if (!vOverlap || rr <= box.left || rect.left >= right) return box;
      let left = box.left, end = right;
      if (rect.left + rect.width / 2 < box.left + box.width / 2) left = Math.min(rr + 4, right - minWidth);
      else end = Math.max(rect.left - 4, left + minWidth);
      return { ...box, left, width: end - left };
    }
    // Which side of the window a strip (the native sidebar) is on.
    const sideOf = (rect, viewWidth) => (rect && rect.left + rect.width / 2 > viewWidth / 2 ? "right" : "left");
    // A button with a second action on a long press. The timer exists only between press and release.
    function createHoldAction({ ms = HOLD_MS, setTimer, clearTimer, onTap, onHold }) {
      let timer = null, held = false, down = false;
      const stop = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
      };
      return {
        press() {
          if (down) return;
          down = true;
          held = false;
          stop();
          timer = setTimer(() => {
            timer = null;
            held = true;
            onHold();
          }, ms);
        },
        release() {
          down = false;
          stop();
          return held;
        },
        cancel() {
          down = false;
          held = false;
          stop();
        },
        // The click that ends a hold is swallowed; any other click (mouse tap, Enter, Space) is a tap.
        click() {
          if (held) {
            held = false;
            return false;
          }
          onTap();
          return true;
        },
        get armed() {
          return timer !== null;
        },
      };
    }
    // Most recently opened note first, no duplicates, at most `max`.
    const pushRecent = (list, id, max = MAX_RECENT) => [id, ...(list || []).filter((x) => x !== id)].slice(0, max);
    const cleanRecent = (raw) =>
      Array.isArray(raw) ? raw.filter((x, i, a) => typeof x === "string" && x && x.length < 80 && a.indexOf(x) === i).slice(0, MAX_RECENT) : [];

    // ======================================================================
    // Store: notes as files, atomic writes, cross-window sync
    // ======================================================================
    function createStore({
      io,
      notify,
      windowId,
      now = () => Date.now(),
      getDir,
      getMaxSaveMs,
      getTrashDays = () => TRASH_DAYS,
      setTimer,
      clearTimer,
      warn = () => {},
      getHistory = () => ({ on: true, ...HISTORY_DEFAULTS }),
    }) {
      const notes = new Map();
      const dirty = new Set();
      const listeners = new Set();
      const backedUp = new Set();
      const DEFAULT_META = { lastNoteId: "", size: "peek", mode: "edit", highlight: "yellow", syncScroll: true, pinned: true, dock: "", geo: {}, recent: [], folders: [], openIn: "", shareDock: 0, shareGap: 0, gapSplit: -1 };
      let meta = { ...DEFAULT_META };
      let dir = null;
      let chain = Promise.resolve();
      let retryTimer = null;
      let metaTimer = null;
      let metaDirty = false;
      let closed = false;
      const state = { save: "saved", error: "" };

      const emit = (type, id, extra = {}) => {
        for (const fn of [...listeners]) {
          try {
            fn({ type, id, ...extra });
          } catch (error) {
            warn(error);
          }
        }
      };
      const fileOf = (id) => io.join(dir, id + ".md");

      async function readNote(file) {
        const name = io.filename(file);
        const id = name.slice(0, -3);
        let text = null;
        for (const candidate of [file, file + ".bak"]) {
          try {
            const t = await io.readUTF8(candidate);
            if (t && t.trim()) {
              text = t;
              break;
            }
          } catch (_) {}
        }
        if (text === null) return null;
        let mtime = now();
        try {
          mtime = (await io.stat(file)).lastModified || mtime;
        } catch (_) {}
        return noteFromFile(id, text, mtime);
      }

      async function loadAll() {
        notes.clear();
        dirty.clear();
        let children = [];
        try {
          children = await io.children(dir);
        } catch (_) {}
        const found = await Promise.all(
          children
            .filter((p) => FILE_RE.test(io.filename(p)))
            .map((p) => readNote(p).catch(() => null)),
        );
        for (const note of found) if (note) notes.set(note.id, note);
      }

      async function loadMeta() {
        meta = { ...DEFAULT_META, geo: {}, recent: [], folders: [] };
        try {
          const raw = JSON.parse(await io.readUTF8(io.join(dir, "meta.json")));
          if (typeof raw.lastNoteId === "string") meta.lastNoteId = raw.lastNoteId;
          if (raw.size === "full" || raw.size === "peek" || raw.size === "span") meta.size = raw.size;
          if (raw.mode === "read" || raw.mode === "edit" || raw.mode === "split") meta.mode = raw.mode;
          if (HIGHLIGHT_COLORS.includes(raw.highlight)) meta.highlight = raw.highlight;
          if (typeof raw.syncScroll === "boolean") meta.syncScroll = raw.syncScroll;
          if (typeof raw.pinned === "boolean") meta.pinned = raw.pinned;
          if (DOCK_MODES.includes(raw.dock)) meta.dock = raw.dock;
          else if (raw.pinned === false) meta.dock = "hover";
          if (raw.geo && typeof raw.geo === "object")
            for (const key of GEO_KEYS) {
              const g = normalizeGeo(raw.geo[key]);
              if (g) meta.geo[key] = g;
            }
          meta.recent = cleanRecent(raw.recent);
          meta.folders = cleanFolders(raw.folders);
          if (OPEN_IN_KINDS.includes(raw.openIn)) meta.openIn = raw.openIn;
          for (const k of ["shareDock", "shareGap"]) {
            const v = Number(raw[k]);
            meta[k] = Number.isFinite(v) && v > 0 ? clampShare(v) : 0;
          }
          // Fraction of the between-panels gap taken from the upper panel; -1 = shared in proportion.
          {
            const v = Number(raw.gapSplit);
            meta.gapSplit = Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 1000) / 1000 : -1;
          }
        } catch (_) {}
      }

      function queue(task) {
        chain = chain.then(task).catch((error) => warn(error));
        return chain;
      }

      function writeMetaNow() {
        if (metaTimer !== null) clearTimer(metaTimer);
        metaTimer = null;
        if (!metaDirty || !dir) return Promise.resolve();
        metaDirty = false;
        const text = JSON.stringify(meta);
        return queue(() =>
          io.writeUTF8(io.join(dir, "meta.json"), text, {
            tmpPath: io.join(dir, "meta.json.tmp"),
          }),
        );
      }
      function setMeta(patch) {
        let changed = false;
        for (const [k, v] of Object.entries(patch))
          if (v && typeof v === "object" ? JSON.stringify(meta[k]) !== JSON.stringify(v) : meta[k] !== v) {
            meta[k] = v;
            changed = true;
          }
        if (!changed) return;
        metaDirty = true;
        if (metaTimer !== null) clearTimer(metaTimer);
        metaTimer = setTimer(writeMetaNow, 600);
      }

      async function writeNoteFile(note, text) {
        const file = fileOf(note.id);
        const opts = { tmpPath: file + ".tmp", flush: true };
        const wantBackup = note._onDisk && !backedUp.has(note.id);
        if (wantBackup) opts.backupFile = file + ".bak";
        await io.writeUTF8(file, text, opts);
        if (wantBackup) backedUp.add(note.id);
        if (!note._onDisk) {
          note._onDisk = true;
          try {
            await io.restrict(file);
          } catch (_) {}
        }
        note._mtime = now();
        notify({ id: note.id, origin: windowId, kind: "saved" });
      }

      // ---- version history: history/<note id>/<UTC stamp>.md, written after a save, rules in the pure core ----
      const lastSnap = new Map(); // note id -> time of its newest snapshot
      const lastSnapText = new Map();
      const histDir = (id) => io.join(dir, HISTORY_DIR, id);
      async function historyNames(id) {
        try {
          return (await io.children(histDir(id))).map((p) => io.filename(p)).filter((n) => parseHistoryName(n));
        } catch (_) {
          return [];
        }
      }
      async function snapHistory(note, text, force = false) {
        const o = getHistory();
        if (!force && !o.on) return;
        if (!io.makeDir || !isAssetNoteId(note.id) || !dir) return;
        const names = await historyNames(note.id);
        if (!lastSnap.has(note.id)) lastSnap.set(note.id, names.reduce((m, n) => Math.max(m, parseHistoryName(n)), 0));
        const bytes = utf8Bytes(text).length;
        if (force ? lastSnapText.get(note.id) === text : !shouldSnapshot({ lastMs: lastSnap.get(note.id), now: now(), minutes: o.minutes, bytes, capKB: o.capKB, same: lastSnapText.get(note.id) === text })) return;
        await io.makeDir(histDir(note.id));
        const name = historyFileName(now(), names);
        await io.writeUTF8(io.join(histDir(note.id), name), text);
        lastSnap.set(note.id, now());
        lastSnapText.set(note.id, text);
        for (const old of pruneHistory([...names, name].map((n) => ({ name: n })), o.keep || HISTORY_DEFAULTS.keep)) await io.remove(io.join(histDir(note.id), old)).catch(() => {});
      }
      function flushDirty() {
        return queue(async () => {
          if (closed || !dir) return;
          if (retryTimer !== null) {
            clearTimer(retryTimer);
            retryTimer = null;
          }
          state.save = "saving";
          emit("status");
          let failed = "";
          for (const id of [...dirty]) {
            const note = notes.get(id);
            if (!note) {
              dirty.delete(id);
              continue;
            }
            const snapshot = serializeNote(note);
            try {
              await writeNoteFile(note, snapshot);
              await snapHistory(note, snapshot).catch(warn); // history never makes a save fail
              if (serializeNote(note) === snapshot) dirty.delete(id);
              else autosaver.touch();
            } catch (error) {
              failed = String(error?.message || error);
              warn(error);
            }
          }
          state.error = failed;
          state.save = failed ? "error" : dirty.size ? "dirty" : "saved";
          if (failed) retryTimer = setTimer(() => autosaver.touch(), 10000);
          emit("status");
        });
      }

      const autosaver = createAutosaver({
        idleMs: () => IDLE_SAVE_MS,
        maxMs: getMaxSaveMs,
        flush: flushDirty,
        setTimer,
        clearTimer,
      });

      function markDirty(id) {
        dirty.add(id);
        state.save = "dirty";
        emit("status");
        autosaver.touch();
      }

      async function reloadFromDisk(id) {
        const file = fileOf(id);
        let exists = false;
        try {
          exists = await io.exists(file);
        } catch (_) {}
        if (!exists) {
          if (notes.has(id) && !dirty.has(id)) {
            notes.delete(id);
            emit("remove", id, { remote: true });
          }
          return;
        }
        if (dirty.has(id)) return; // local edits win until they are saved
        const fresh = await readNote(file).catch(() => null);
        if (!fresh) return;
        notes.set(id, fresh);
        emit("change", id, { remote: true });
      }

      async function purgeOldTrash() {
        const plan = trashPlan([...notes.values()], cleanTrashDays(getTrashDays()), now());
        for (const id of plan.expired) await removeNoteFiles(id);
      }
      function removeNoteFiles(id) {
        notes.delete(id);
        dirty.delete(id);
        const file = fileOf(id);
        return queue(async () => {
          for (const p of [file, file + ".bak", file + ".tmp"])
            await io.remove(p).catch(() => {});
          // Pictures go with their note, unless another note (a copy, pasted text) still shows them.
          const prefix = ASSET_DIR + "/" + id + "/";
          const shared = [...notes.values()].some((n) => [...assetRefs(n.body)].some((r) => r.startsWith(prefix)));
          if (io.removeTree && isAssetNoteId(id) && !shared) await io.removeTree(io.join(dir, ASSET_DIR, id)).catch(() => {});
          if (io.removeTree && isAssetNoteId(id)) await io.removeTree(histDir(id)).catch(() => {});
          lastSnap.delete(id);
          lastSnapText.delete(id);
          notify({ id, origin: windowId, kind: "deleted" });
        });
      }

      const api = {
        state,
        get meta() {
          return meta;
        },
        get dir() {
          return dir;
        },
        on(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        async open() {
          closed = false;
          dir = await getDir();
          await loadAll();
          await loadMeta();
          await purgeOldTrash();
          emit("reset");
        },
        async switchDir() {
          await api.flush();
          await api.open();
        },
        get(id) {
          return notes.get(id) || null;
        },
        list({ query = "", trashed = false } = {}) {
          const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
          return [...notes.values()]
            .filter(
              (n) =>
                !!n.trashed === trashed &&
                terms.every((t) => n.body.toLowerCase().includes(t) || (n.label || "").toLowerCase().includes(t)),
            )
            .sort((a, b) =>
              trashed
                ? b.trashed - a.trashed
                : Number(b.pinned) - Number(a.pinned) || b.updated - a.updated,
            );
        },
        trashCount: () => [...notes.values()].filter((n) => n.trashed).length,
        latestId() {
          const last = notes.get(meta.lastNoteId);
          if (last && !last.trashed) return last.id;
          return api.list()[0]?.id || "";
        },
        // Creates a note with a fixed id unless that id already exists (even trashed): used for the demo notes, so
        // installing twice never duplicates or overwrites what the person edited. Returns the note and whether it is new.
        ensureNote(id, body, folder = "") {
          if (!NOTE_ID_RE.test(String(id))) return { note: null, created: false };
          const have = notes.get(id);
          if (have) return { note: have, created: false };
          const t = now();
          const note = { id, body, created: t, updated: t, color: "none", label: "", folder: cleanFolder(folder), pinned: false, trashed: 0, remind: 0, reminded: 0, _onDisk: false, _mtime: t };
          notes.set(id, note);
          if (body) markDirty(id);
          emit("change", id, { created: true });
          return { note, created: true };
        },
        create(body = "", folder = "") {
          let id = makeId(now());
          while (notes.has(id)) id = makeId(now());
          const t = now();
          const note = {
            id,
            body,
            created: t,
            updated: t,
            color: "none",
            label: "",
            folder: cleanFolder(folder),
            pinned: false,
            trashed: 0,
            remind: 0,
            reminded: 0,
            _onDisk: false,
            _mtime: t,
          };
          notes.set(id, note);
          if (body) markDirty(id);
          emit("change", id, { created: true });
          return note;
        },
        update(id, body, source) {
          const note = notes.get(id);
          if (!note || note.body === body) return;
          note.body = body;
          note.updated = now();
          if (body.trim() || note._onDisk) markDirty(id);
          else dirty.delete(id);
          emit("change", id, { source });
        },
        setColor(id, color) {
          const note = notes.get(id);
          if (!note || !NOTE_COLORS.includes(color) || note.color === color) return;
          note.color = color;
          if (note.body.trim() || note._onDisk) markDirty(id);
          emit("change", id, { meta: true });
        },
        setLabel(id, label) {
          const note = notes.get(id);
          const next = cleanLabel(label);
          if (!note || (note.label || "") === next) return;
          note.label = next;
          if (note.body.trim() || note._onDisk) markDirty(id);
          emit("change", id, { meta: true });
        },
        // Rename a label on every note in one pass (case-insensitive match). `to` = "" removes it; a name that already
        // exists merges the two. Trashed notes are included so no stale label is left. Returns how many notes changed.
        renameLabel(from, to) {
          const want = cleanLabel(from).toLowerCase();
          if (!want) return 0;
          const next = cleanLabel(to);
          let changed = 0;
          for (const note of notes.values()) {
            if (cleanLabel(note.label).toLowerCase() !== want || note.label === next) continue;
            note.label = next;
            if (note.body.trim() || note._onDisk) markDirty(note.id);
            emit("change", note.id, { meta: true });
            changed++;
          }
          return changed;
        },
        setPinned(id, pinned) {
          const note = notes.get(id);
          if (!note || note.pinned === !!pinned) return;
          note.pinned = !!pinned;
          if (note.body.trim() || note._onDisk) markDirty(id);
          emit("change", id, { meta: true });
        },
        // ---- reminders (P2) ---------------------------------------------------------------------------
        // setReminder(id, time) sets (or with 0 clears) a reminder; the time snaps to 5 minutes and any earlier
        // "announced" stamp is forgotten. snoozeReminder moves it `minutes` ahead from now.
        setReminder(id, time) {
          const note = notes.get(id);
          if (!note) return false;
          const next = time ? cleanRemind(time) : 0;
          if (time && !next) return false;
          if (note.remind === next && (!next || !note.reminded)) return true;
          note.remind = next;
          note.reminded = 0;
          if (note.body.trim() || note._onDisk) markDirty(id);
          emit("change", id, { meta: true, reminder: true });
          return true;
        },
        snoozeReminder(id, minutes) {
          const note = notes.get(id);
          const m = Number(minutes);
          if (!note || !(m > 0 && m <= 60 * 24 * 365)) return false;
          return api.setReminder(id, ceilStep(now() + m * 60000));
        },
        // Records that the reminder was announced. Re-reads the file first, so a second window that already
        // announced it (and saved that) wins and this one stays silent. Resolves true only when THIS call
        // claimed the announcement.
        async claimReminder(id) {
          if (!notes.has(id)) return false;
          if (notes.get(id)._onDisk && !dirty.has(id)) await reloadFromDisk(id).catch(warn);
          const note = notes.get(id);
          if (!note || !reminderPending(note) || note.remind > now()) return false;
          note.reminded = note.remind;
          markDirty(id);
          emit("change", id, { meta: true, reminder: true });
          await flushDirty();
          return true;
        },
        // ---- pictures (P2): saved under assets/<note id>/, see "pasted pictures" in the pure core ----------
        async saveAsset(noteId, bytes, claimedMime = "") {
          const note = notes.get(noteId);
          if (!dir || !note || note.trashed) return { ok: false, reason: "note" };
          if (!isAssetNoteId(noteId)) return { ok: false, reason: "note-name" };
          const chk = checkAssetBytes(bytes, claimedMime);
          if (!chk.ok) return chk;
          if (!io.makeDir || !io.writeBytes) return { ok: false, reason: "io" };
          const folder = io.join(dir, ASSET_DIR, noteId);
          try {
            await io.makeDir(folder);
            let existing = [];
            try { existing = await io.children(folder); } catch (_) {}
            if (existing.length >= ASSET_MAX_PER_NOTE) return { ok: false, reason: "too-many" };
            for (let tries = 0; tries < 5; tries++) {
              const file = assetFileName(chk.ext, now());
              if (existing.some((p) => io.filename(p) === file)) continue;
              await io.writeBytes(io.join(folder, file), bytes);
              return { ok: true, rel: assetRel(noteId, file), mime: chk.mime };
            }
            return { ok: false, reason: "name" };
          } catch (error) {
            warn(error);
            return { ok: false, reason: "io" };
          }
        },
        // Reads a picture named by a note link. Only paths that pass parseAssetLink are ever touched.
        async readAsset(src) {
          const link = parseAssetLink(src);
          if (!link || !dir || !io.readBytes) return null;
          try {
            const bytes = await io.readBytes(io.join(dir, ASSET_DIR, link.noteId, link.file));
            const mime = sniffImageMime(bytes);
            return mime && bytes.length <= ASSET_MAX_BYTES ? { bytes, mime } : null;
          } catch (_) {
            return null;
          }
        },
        /* NOT ACTIVE CODE (kept for a possible future sync through a linked GitHub repository; Zen Sync is rejected, see mergeRemote's comment).
         * adoptRemote(r) takes a note that arrived from elsewhere ({ id, body, folder, color, updated }) after a merge decision said
         * "create" or "update", and stores it under its own id; the first overwrite of an existing file is backed up (.bak) by writeNoteFile.
         * isDirty: (id) => dirty.has(id),
         * // A note that arrived from another source. The caller already ran a merge decision; the first
         * // overwrite of an existing file is backed up by writeNoteFile (.bak). Returns the note.
         * adoptRemote(r) {
         *   let note = notes.get(r.id);
         *   if (!note) {
         *     note = { id: r.id, body: "", created: r.updated, updated: r.updated, color: "none", label: "", folder: "", pinned: false, trashed: 0, remind: 0, reminded: 0, _onDisk: false, _mtime: now() };
         *     notes.set(r.id, note);
         *   }
         *   note.body = r.body;
         *   note.color = r.color;
         *   note.folder = cleanFolder(r.folder);
         *   note.updated = r.updated;
         *   markDirty(r.id);
         *   emit("change", r.id, { remote: true });
         *   emit("tree", r.id);
         *   return note;
         * },
         */
        // ---- version history ----------------------------------------------------------------------------
        async listHistory(id) {
          if (!dir || !isAssetNoteId(id)) return [];
          const out = [];
          for (const name of await historyNames(id)) {
            let size = 0;
            try { size = (await io.stat(io.join(histDir(id), name))).size || 0; } catch (_) {}
            out.push({ name, ms: parseHistoryName(name), size });
          }
          return out.sort((a, b) => b.ms - a.ms || (a.name < b.name ? 1 : -1));
        },
        async readVersion(id, name) {
          if (!dir || !isAssetNoteId(id) || !parseHistoryName(name)) return null;
          try {
            const text = await io.readUTF8(io.join(histDir(id), name));
            return noteFromFile(id, text, now()).body;
          } catch (_) {
            return null;
          }
        },
        // The current text is kept as a snapshot first, so a restore can itself be undone from the list.
        async restoreVersion(id, name) {
          const note = notes.get(id);
          const body = await api.readVersion(id, name);
          if (!note || body === null) return false;
          await snapHistory(note, serializeNote(note), true).catch(warn);
          api.update(id, body, "history");
          return true;
        },
        async historyUsage() {
          let bytes = 0, files = 0;
          if (!dir || !io.children) return { bytes, files };
          let ids = [];
          try { ids = await io.children(io.join(dir, HISTORY_DIR)); } catch (_) { return { bytes, files }; }
          for (const p of ids) {
            let kids = [];
            try { kids = await io.children(p); } catch (_) { continue; }
            for (const k of kids) {
              try { bytes += (await io.stat(k)).size || 0; files++; } catch (_) {}
            }
          }
          return { bytes, files };
        },
        async clearHistory(id) {
          if (!dir || !io.removeTree || !isAssetNoteId(id)) return false;
          await io.removeTree(histDir(id)).catch(() => {});
          lastSnap.delete(id);
          lastSnapText.delete(id);
          return true;
        },
        // ---- folders (D2): the tree is the source of truth, files only carry `folder:` ----------------
        tree() {
          return buildTree([...notes.values()], meta.folders);
        },
        setFolder(id, folderId) {
          const note = notes.get(id);
          const next = cleanFolder(folderId);
          if (!note || cleanFolder(note.folder) === next) return false;
          note.folder = next;
          if (note.body.trim() || note._onDisk) markDirty(id);
          emit("change", id, { meta: true });
          emit("tree", id);
          return true;
        },
        // The reserved "tabbar" folder (what the Zen sidebar shows in mode "selected"); created on demand.
        ensureTabbarFolder() {
          if (meta.folders.some((f) => f.id === TABBAR_FOLDER)) return TABBAR_FOLDER;
          setMeta({ folders: [...meta.folders, { id: TABBAR_FOLDER, label: TABBAR_LABEL, order: 0, collapsed: false }] });
          emit("tree", TABBAR_FOLDER);
          return TABBAR_FOLDER;
        },
        addFolder(label, parentId = "") {
          const r = addFolderMeta(meta.folders, [...notes.values()], parentId, label);
          if (!r) return "";
          setMeta({ folders: r.folders });
          emit("tree", r.id);
          return r.id;
        },
        renameFolder(id, label) {
          const list = patchFolderMeta(meta.folders, id, { label });
          if (!list) return false;
          setMeta({ folders: list });
          emit("tree", id);
          return true;
        },
        setFolderCollapsed(id, collapsed) {
          const list = patchFolderMeta(meta.folders, id, { collapsed: !!collapsed });
          if (!list) return false;
          setMeta({ folders: list });
          emit("tree", id);
          return true;
        },
        removeFolder(id, mode = "toRoot") {
          const r = deleteFolder(meta.folders, [...notes.values()], id, mode);
          if (!r) return false;
          for (const c of r.changes) {
            const note = notes.get(c.id);
            if (!note) continue;
            note.folder = c.folder;
            if (c.trash) note.trashed = now();
            if (note.body.trim() || note._onDisk) markDirty(c.id);
          }
          setMeta({ folders: r.folders });
          for (const c of r.changes) emit("change", c.id, { meta: true });
          emit("tree", id);
          return true;
        },
        moveFolder(id, newParent) {
          const r = reparentFolder(meta.folders, [...notes.values()], id, newParent);
          if (!r) return "";
          for (const c of r.changes) {
            const note = notes.get(c.id);
            if (!note) continue;
            note.folder = c.folder;
            if (note.body.trim() || note._onDisk) markDirty(c.id);
          }
          setMeta({ folders: r.folders });
          for (const c of r.changes) emit("change", c.id, { meta: true });
          emit("tree", r.id);
          return r.id;
        },
        trash(id) {
          const note = notes.get(id);
          if (!note) return;
          if (!note._onDisk && !note.body.trim()) {
            notes.delete(id);
            emit("remove", id);
            return;
          }
          note.trashed = now();
          markDirty(id);
          emit("change", id, { meta: true });
        },
        restore(id) {
          const note = notes.get(id);
          if (!note || !note.trashed) return;
          note.trashed = 0;
          markDirty(id);
          emit("change", id, { meta: true });
        },
        async deleteForever(id) {
          await removeNoteFiles(id);
          emit("remove", id);
        },
        async emptyTrash() {
          for (const n of [...notes.values()])
            if (n.trashed) await removeNoteFiles(n.id);
          emit("reset");
        },
        // An untouched new note leaves no file behind.
        discardIfEmpty(id) {
          const note = notes.get(id);
          if (note && !note._onDisk && !note.body.trim()) {
            notes.delete(id);
            dirty.delete(id);
            emit("remove", id);
          }
        },
        setMeta,
        flush() {
          autosaver.cancel();
          return Promise.all([flushDirty(), writeMetaNow()]);
        },
        // Picks up files added or edited by other apps (sync tools, editors).
        async refresh() {
          if (!dir) return;
          let children = [];
          try {
            children = await io.children(dir);
          } catch (_) {
            return;
          }
          const present = new Set();
          for (const p of children) {
            const name = io.filename(p);
            if (!FILE_RE.test(name)) continue;
            const id = name.slice(0, -3);
            present.add(id);
            const known = notes.get(id);
            if (dirty.has(id)) continue;
            let mtime = 0;
            try {
              mtime = (await io.stat(p)).lastModified || 0;
            } catch (_) {}
            if (!known || mtime > known._mtime + 2000) await reloadFromDisk(id);
          }
          for (const [id, n] of [...notes]) {
            if (n._onDisk && !present.has(id) && !dirty.has(id)) {
              notes.delete(id);
              emit("remove", id, { remote: true });
            }
          }
        },
        onRemoteMessage(data) {
          let msg;
          try {
            msg = JSON.parse(data);
          } catch (_) {
            return;
          }
          if (!msg || msg.origin === windowId || !dir) return;
          if (typeof msg.id !== "string" || !/^[\w.-]+$/.test(msg.id)) return;
          reloadFromDisk(msg.id).catch(warn);
        },
        async close() {
          await api.flush();
          closed = true;
          if (retryTimer !== null) clearTimer(retryTimer);
          retryTimer = null;
        },
      };
      return api;
    }

    // ======================================================================
    // Test seam (unit tests only; absent in Zen)
    // ======================================================================
    // Menu placement (pure): right-aligned to the anchor, kept inside both the host sheet and the
    // viewport, flipped above the anchor when there is no room below, and given a max height (so it
    // scrolls) when it is taller than the available space. Returns coordinates relative to the host.
    function menuPosition({ anchor, host, viewport, size, pad = 6 }) {
      const minX = Math.max(pad, host.left + 4),
        maxX = Math.min(viewport.width - pad, host.right - 4);
      const minY = Math.max(pad, host.top + 4),
        maxY = Math.min(viewport.height - pad, host.bottom - 4);
      const width = Math.min(size.width, Math.max(0, maxX - minX));
      let height = size.height;
      const below = maxY - (anchor.bottom + 4),
        above = anchor.top - 4 - minY;
      const useBelow = height <= below || below >= above;
      const room = Math.max(60, useBelow ? below : above);
      let maxHeight = 0;
      if (height > room) {
        maxHeight = Math.floor(room);
        height = room;
      }
      const x = Math.max(minX, Math.min(anchor.right - width, maxX - width));
      const y = useBelow ? anchor.bottom + 4 : anchor.top - 4 - height;
      return {
        left: Math.round(x - host.left),
        top: Math.round(Math.max(minY, y) - host.top),
        maxHeight,
      };
    }

    // ---- V4-QS: where a dialog card goes ---------------------------------------------------------------
    // `size` = the card's natural (max-content) size in px, `sheet` = the sheet's rect, `viewport` = the window.
    // A card that fits inside the sheet stays centered by the overlay (spill: false). A bigger one (large font)
    // grows past the sheet, centered on it and clamped into the window, and scrolls only when it is bigger than
    // the window. Offsets are relative to the sheet, whose overflow is lifted while a card spills.
    function fitDialog({ sheet, viewport, size, pad = 6, inset = 12 }) {
      const roomW = Math.max(0, sheet.width - inset * 2), roomH = Math.max(0, sheet.height - inset * 2);
      if (size.width <= roomW && size.height <= roomH) return { spill: false, left: 0, top: 0, width: 0, height: 0, scroll: false };
      const maxW = Math.max(120, viewport.width - pad * 2), maxH = Math.max(80, viewport.height - pad * 2);
      const width = Math.min(Math.max(size.width, 1), maxW), height = Math.min(Math.max(size.height, 1), maxH);
      const cx = sheet.left + sheet.width / 2, cy = sheet.top + sheet.height / 2;
      const x = Math.max(pad, Math.min(cx - width / 2, viewport.width - pad - width));
      const y = Math.max(pad, Math.min(cy - height / 2, viewport.height - pad - height));
      return { spill: true, left: Math.round(x - sheet.left), top: Math.round(y - sheet.top), width: Math.round(width), height: Math.round(height), scroll: size.width > maxW || size.height > maxH };
    }

    // ---- V4-R2: window modes + hover timing (pure) ------------------------------------------------------
    // pin = stays open over the panel (overlay, no push); hover = a thin real strip, opens on hover and closes
    // after a grace; dock = stays open and keeps its own slot (pushes the page / panels).
    const DOCK_MODES = Object.freeze(["pin", "hover", "dock"]);
    // Where Notes was open when the window closed (restored with "Open on Startup"): the bar kind, or "" = closed.
    const OPEN_IN_KINDS = Object.freeze(["", "primary", "triple", "super"]);
    const cleanDockMode = (v, fallback = "dock") => (DOCK_MODES.includes(v) ? v : fallback);
    const HOVER_CLOSE_GRACE_MS = 600;
    const hoverStripPx = (v) => Math.max(8, Math.min(16, Math.round(Number(v)) || 10));
    function hoverTiming({ open, grace } = {}) {
      const o = Number(open);
      const g = Number(grace);
      return {
        openMs: Number.isFinite(o) ? Math.max(0, Math.min(1000, Math.round(o))) : 100,
        graceMs: Math.max(HOVER_CLOSE_GRACE_MS, Number.isFinite(g) ? Math.round(g) : HOVER_CLOSE_GRACE_MS),
      };
    }
    // A hover-opened sheet may only fold away when nothing holds it open.
    const hoverMayClose = ({ focusInside = false, menuOpen = false, dialogOpen = false, pointerDown = false, gesture = false, pointerInside = false } = {}) =>
      !(focusInside || menuOpen || dialogOpen || pointerDown || gesture || pointerInside);
    // ======================================================================
    // Pure core: roadmap leftovers (heading anchors, footnotes, mentions, hub lists, date notes, version
    // history, [[ completion) and the Zen experiments (projection modes, perf sampler).
    // Nothing in this block touches the browser, a tab, a preference or the disk.
    // ======================================================================
    // ---- heading anchors: [label](<id>.md#heading-slug) ------------------------------------------
    function headingSlug(text) {
      const s = foldText(cleanLine(String(text ?? "")))
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/[\s-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      return s || "section";
    }
    // Headings of a body (outside code fences) with unique slugs: a repeated title gets -1, -2 ...
    function headingsOf(body) {
      const out = [];
      const seen = new Map();
      let fence = false;
      String(body ?? "").split("\n").forEach((line, i) => {
        if (/^ {0,3}(```|~~~)/.test(line)) {
          fence = !fence;
          return;
        }
        if (fence) return;
        const m = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (!m) return;
        const base = headingSlug(m[2]);
        const n = seen.get(base) || 0;
        seen.set(base, n + 1);
        out.push({ level: m[1].length, text: cleanLine(m[2]) || base, slug: n ? base + "-" + n : base, line: i });
      });
      return out;
    }
    function cleanAnchor(raw) {
      let h = String(raw ?? "");
      try {
        h = decodeURIComponent(h);
      } catch (_) {
        return "";
      }
      return /^[a-z0-9][a-z0-9-]{0,79}$/.test(h) ? h : "";
    }
    // { id, heading } for a note link ("" heading = the whole note); null when it is not a note link.
    function noteLinkParts(href) {
      const id = noteLinkTarget(href);
      if (!id) return null;
      const hash = /#([^\s]*)$/.exec(String(href));
      return { id, heading: hash ? cleanAnchor(hash[1]) : "" };
    }

    // Broken links checker (Cycle G #36). Pure, read only: reports links that lead nowhere, never changes a note.
    // kind: "missing-note" (no such note, or a [[title]] nobody has), "trashed" (the target is in the Trash),
    // "missing-heading" (the note exists, the #heading does not). Links inside code are ignored. Missing assets are NOT checked here.
    const BROKEN_MAX = 500;
    function findBrokenLinks(notes) {
      const all = new Map(notes.map((n) => [n.id, n]));
      const live = notes.filter((n) => !n.trashed);
      const out = [];
      for (const n of live) {
        const seen = new Set();
        const add = (item) => {
          const key = item.raw + "\u0000" + item.kind;
          if (seen.has(key) || out.length >= BROKEN_MAX) return;
          seen.add(key);
          out.push({ noteId: n.id, ...item });
        };
        mapOutsideCode(n.body, (seg, line) => {
          for (const m of seg.matchAll(/(!?)\[([^\[\]\n]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
            if (m[1]) continue; // images are not note links
            const parts = noteLinkParts(m[3]);
            if (!parts) continue;
            const target = all.get(parts.id);
            const base = { line, raw: m[0], label: m[2] || parts.id, targetId: parts.id, anchor: parts.heading, title: parts.id };
            if (!target) add({ ...base, kind: "missing-note" });
            else if (target.trashed) add({ ...base, kind: "trashed", title: titleOf(target.body) || parts.id });
            else if (parts.heading && !headingsOf(target.body).some((x) => x.slug === parts.heading)) add({ ...base, kind: "missing-heading", title: titleOf(target.body) || parts.id });
          }
          for (const m of seg.matchAll(new RegExp(WIKI_RE.source, "g"))) {
            const title = m[1].trim();
            if (!resolveNoteTitle(notes, title)) add({ line, raw: m[0], label: (m[2] || title).trim(), targetId: "", anchor: "", title, kind: "missing-note" });
          }
          return seg;
        });
      }
      return out;
    }
    // The broken link written as plain text again (the words stay): [label](x.md) -> label, [[a|b]] -> b.
    function unlinkBroken(body, item) {
      return mapOutsideCode(body, (seg) => seg.split(item.raw).join(item.label));
    }
    const headingOffset = (body, slug) => {
      const hit = headingsOf(body).find((x) => x.slug === slug);
      if (!hit) return -1;
      const lines = String(body).split("\n");
      let off = 0;
      for (let i = 0; i < hit.line; i++) off += lines[i].length + 1;
      return off;
    };

    // What the pinned strip shows (Cycle F #29): up to `max` pinned notes and the recent ones that are not the open note.
    function stripModel(notes, recentIds, currentId, max = 8) {
      const live = (notes || []).filter((n) => n && !n.trashed);
      const pinned = live.filter((n) => n.pinned).slice(0, max).map((n) => ({ id: n.id, title: titleOf(n.body) || n.label || "Untitled note" }));
      const byId = new Map(live.map((n) => [n.id, n]));
      const recent = (recentIds || []).filter((id) => id !== currentId && byId.has(id)).slice(0, MAX_RECENT).map((id) => ({ id, title: titleOf(byId.get(id).body) || byId.get(id).label || "Untitled note" }));
      return { pinned, recent };
    }
    // Note templates (Cycle G #35). User templates are ordinary notes in the reserved "Templates" folder (they sync with the
    // profile and are edited like any note). The built-ins below are offered from code until a note with the same fixed id
    // exists (the user's edited copy then wins, a trashed copy stays gone). Variables: {{date}} {{time}} {{title}} {{cursor}} only.
    const TEMPLATE_FOLDER = "templates";
    const BUILTIN_TEMPLATES = Object.freeze([
      { id: "zn-tpl-meeting", name: "Meeting", body: "# {{title}}\n\n**Date:** {{date}} {{time}}\n**Attendees:** \n\n## Agenda\n\n- {{cursor}}\n\n## Notes\n\n## Decisions\n\n## Action items\n\n- [ ] \n" },
      { id: "zn-tpl-daily", name: "Daily", body: "# {{date}}\n\n## Plan\n\n- [ ] {{cursor}}\n\n## Notes\n\n## Done\n" },
      { id: "zn-tpl-checklist", name: "Checklist", body: "# {{title}}\n\n- [ ] {{cursor}}\n- [ ] \n- [ ] \n" },
      { id: "zn-tpl-project", name: "Project", body: "# {{title}}\n\n**Started:** {{date}}\n\n## Goal\n\n{{cursor}}\n\n## Milestones\n\n- [ ] \n\n## Tasks\n\n- [ ] \n\n## Links\n\n## Log\n\n- {{date}} created\n" },
    ]);
    const templateNeedsTitle = (body) => String(body ?? "").includes("{{title}}");
    // Fills the variables; the first {{cursor}} gives the caret, any further ones vanish. Unknown {{x}} stays as typed.
    function applyTemplate(body, { now = Date.now(), title = "" } = {}) {
      const d = new Date(now);
      const time = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      const t = String(title ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
      const fill = (seg) => seg.split("{{date}}").join(ymdOf(now)).split("{{time}}").join(time).split("{{title}}").join(t);
      const parts = String(body ?? "").split("{{cursor}}").map(fill);
      return { body: parts.join(""), caret: parts[0].length };
    }
    // Menu entries: the user's templates (non-trashed notes in the Templates folder), then built-ins nobody has a note for.
    function templateChoices(notes) {
      const user = notes.filter((n) => !n.trashed && cleanFolder(n.folder) === TEMPLATE_FOLDER).map((n) => ({ id: n.id, name: titleOf(n.body) || "Untitled template", body: n.body, builtin: false }));
      const have = new Set(notes.map((n) => n.id));
      const builtin = BUILTIN_TEMPLATES.filter((b) => !have.has(b.id)).map((b) => ({ ...b, builtin: true }));
      return [...user, ...builtin];
    }
    // Demo / showcase notes (Cycle F #3): fixed ids so installing twice changes nothing. They double as a manual test fixture.
    const DEMO_FOLDER = "help"; // folder id (lowercase slug); the visible label is "Help"
    const DEMO_NOTES = Object.freeze([
      { id: "zn-demo-tour", body: [
        "# Notes syntax tour", "",
        "Everything here is plain Markdown. Switch between Edit, Read and Split with the toolbar to compare.", "",
        "## Text", "",
        "**bold**, *italic*, ~~strikethrough~~, ==highlight==, =={green}green highlight==, `inline code`, X^2^, H~2~O and <kbd>Ctrl</kbd>.", "",
        "## Lists", "",
        "- one", "  - nested", "    - deeper", "- two", "", "1. first", "2. second", "", "- [ ] a task", "- [x] a finished task", "",
        "## Quote, code and table", "",
        "> A quote can have **formatting** too.", "",
        "```js", "const answer = 42; // fenced code keeps its spacing", "```", "",
        "| Name | Value |", "| --- | --- |", "| left | 1 |", "| right | 2 |", "",
        "## Links and footnotes", "",
        "A [web link](https://example.com), a link to another note: [[Linking notes demo]], and a footnote.[^1]", "",
        "[^1]: Footnotes are collected at the bottom of the read view.", "",
        "---", "", "Next: [[Callouts and reminders]]", ""].join("\n") },
      { id: "zn-demo-links", body: [
        "# Linking notes demo", "",
        "Write `[[` and start typing a note's title to link to it. Links work in both directions:", "",
        "- This note links to [[Notes syntax tour]] and [[Callouts and reminders]].",
        "- Open one of them and look at *Linked from* at the bottom: this note is listed there (More > Notes that link here).", "",
        "## Jump inside a note", "",
        "[Go to Section B](#section-b) scrolls to the heading below.", "",
        "## Section A", "", "Some text.", "",
        "## Section B", "", "You landed here. Try More > Outline to see every heading of this note.", ""].join("\n") },
      { id: "zn-demo-callouts", body: [
        "# Callouts and reminders", "",
        "> [!NOTE]", "> A note callout. Insert one from the caret menu next to the toolbar: Callout.", "",
        "> [!TIP] A tip with its own title", "> Tips can have several lines.", "> Second line.", "",
        "> [!IMPORTANT]", "> Important.", "", "> [!WARNING]", "> Warning.", "", "> [!CAUTION]", "> Caution.", "", "> [!INFO]", "> Info.", "",
        "## Reminders", "",
        "Open More > Remind me..., pick a time (to the minute) and a bell chip appears beside the title when it is set.",
        "Try a time two minutes from now to see the notification.", ""].join("\n") },
      { id: "zn-demo-torture", body: [
        "# Torture test (placeholder)", "",
        "These lines poke at edge cases. Each should render without breaking the layout; the owner's own torture test should replace or extend this note.", "",
        "- unclosed **bold and *italic", "- =={nonsense}unknown highlight colour==", "- ==== and =={red}== stay literal", "- <b>raw html is shown as text</b>",
        "- escaped \\*stars\\* and a lone * star", "- a very long unbroken word: " + "x".repeat(120), "- unicode: zażółć gęślą jaźń, 日本語, emoji 🙂", "",
        "#### Empty list items and fences", "", "-", "- ", "", "```", "an unclosed code fence swallows the rest, as in GitHub", "",
        "Not supported yet (see the roadmap, Cycle G): `![[embed]]`. Extra task states `[-]` `[/]` `[?]` `[!]` work (hold the checklist button).", ""].join("\n") },
    ]);
    const demoTitle = (d) => titleOf(d.body);

    // Quick capture (Cycle G #34): one line appended to a note. "bullet-time" = "- 14:05 text" (local time), "task" = "- [ ] text".
    const CAPTURE_FORMATS = Object.freeze(["bullet-time", "plain", "task"]);
    const cleanCaptureFormat = (v) => (CAPTURE_FORMATS.includes(v) ? v : "bullet-time");
    function captureLine(text, format, ms) {
      const t = String(text ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
      if (!t) return "";
      const f = cleanCaptureFormat(format);
      if (f === "plain") return t;
      if (f === "task") return "- [ ] " + t;
      const d = new Date(ms);
      return `- ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${t}`;
    }
    // Puts `line` on its own line at `at` (default: end of the note); never glues lines, never leaves a blank gap.
    function insertLineAt(body, line, at) {
      const b = String(body ?? "");
      if (!line) return b;
      const pos = at === undefined ? b.length : Math.max(0, Math.min(b.length, at));
      const before = b.slice(0, pos), after = b.slice(pos);
      const lead = before && !before.endsWith("\n") ? "\n" : "";
      return before + lead + line + "\n" + (at !== undefined && after.startsWith("\n") ? after.slice(1) : after);
    }
    // Labels in use (Cycle F #19): [{ label, count }], live notes only, matched case-insensitively (the first spelling wins),
    // most used first, then alphabetical.
    function labelSummary(notes) {
      const map = new Map();
      for (const n of notes || []) {
        const l = cleanLabel(n && !n.trashed ? n.label : "");
        if (!l) continue;
        const k = l.toLowerCase();
        map.set(k, { label: map.get(k)?.label || l, count: (map.get(k)?.count || 0) + 1 });
      }
      return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }
    // Outline of a note (Cycle F #27): its headings with the one the caret is under marked `current`. At most `max`
    // are listed; `more` says how many were left out. Levels are shifted so the shallowest heading sits at 1.
    function outlineItems(body, caretLine = -1, max = 60) {
      const all = headingsOf(body);
      const top = all.length ? Math.min(...all.map((x) => x.level)) : 1;
      let cur = -1;
      all.forEach((x, i) => { if (caretLine >= 0 && x.line <= caretLine) cur = i; });
      return { items: all.slice(0, max).map((x, i) => ({ level: x.level - top + 1, text: x.text, slug: x.slug, line: x.line, current: i === cur })), more: Math.max(0, all.length - max) };
    }
    // ---- footnotes: [^1] in the text, [^1]: the note, at any line -------------------------------------
    const FOOT_DEF_RE = /^ {0,3}\[\^([^\]\s]{1,40})\]:\s*(.*)$/;
    const FOOT_MAX = 200;
    let FOOTS = null; // label -> text, set for the duration of one parseBlocks
    let FOOT_ORDER = null; // labels in the order of first use (that is the number shown)
    // Takes the definition lines out (blanked, so line numbers stay true). An indented line right after one
    // continues it. Only one level: a definition cannot contain blocks.
    function collectFootnotes(lines) {
      const defs = new Map();
      let fence = false;
      for (let i = 0; i < lines.length; i++) {
        if (/^```/.test(lines[i])) {
          fence = !fence;
          continue;
        }
        if (fence) continue;
        const m = FOOT_DEF_RE.exec(lines[i]);
        if (!m) continue;
        let text = m[2].trim();
        lines[i] = "";
        while (i + 1 < lines.length && /^(?: {4}|\t)\S/.test(lines[i + 1])) {
          text += " " + lines[i + 1].trim();
          lines[++i] = "";
        }
        if (!defs.has(m[1])) defs.set(m[1], text);
      }
      return defs;
    }
    function footnoteBlock(line) {
      if (!FOOT_ORDER || !FOOT_ORDER.length) return null;
      const items = [];
      for (let i = 0; i < FOOT_ORDER.length && i < FOOT_MAX; i++) items.push({ label: FOOT_ORDER[i], n: i + 1, c: parseInline(FOOTS.get(FOOT_ORDER[i]) || "") });
      return { type: "footnotes", items, line };
    }
    function nextFootnoteLabel(value) {
      const used = new Set([...String(value).matchAll(/\[\^([^\]\s]{1,40})\]/g)].map((m) => m[1]));
      let n = 1;
      while (used.has(String(n))) n++;
      return String(n);
    }
    // One edit: the reference at the caret and an empty definition at the end of the note.
    function insertFootnote(value, s, e) {
      const label = nextFootnoteLabel(value);
      const tail = String(value).slice(e).replace(/\s+$/, "");
      const def = "\n\n[^" + label + "]: ";
      const text = "[^" + label + "]" + tail + def;
      const caret = s + text.length;
      return { start: s, end: value.length, text, selStart: caret, selEnd: caret };
    }

    // ---- mentions without a link, and turning one into a link -------------------------------------
    const MENTION_MIN = 3;
    function mentionRe(title) {
      const t = String(title ?? "").trim();
      if (t.length < MENTION_MIN) return null;
      const src = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      return new RegExp("(?<![\\p{L}\\p{N}_])" + src + "(?![\\p{L}\\p{N}_])", "iu");
    }
    // Runs fn over text that is outside code, outside [[wiki]] links, Markdown links and web addresses.
    function mapOutsideLinks(text, fn) {
      return mapOutsideCode(text, (seg) =>
        seg.split(/(\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)|<?https?:\/\/[^\s<>)]+>?)/).map((p, i) => (i % 2 ? p : fn(p))).join(""),
      );
    }
    function hasMention(body, re) {
      let hit = false;
      mapOutsideLinks(body, (seg) => {
        if (!hit && re.test(seg)) hit = true;
        return seg;
      });
      return hit;
    }
    // The body with the first plain mention of `title` turned into a link to `id`; null if there is none.
    function linkFirstMention(body, title, id) {
      const re = mentionRe(title);
      if (!re) return null;
      let done = false;
      const out = mapOutsideLinks(body, (seg) => (done ? seg : seg.replace(re, (all) => ((done = true), buildNoteLink(id, all)))));
      return done ? out : null;
    }

    // ---- hub notes: a list of links, each with a short description -----------------------------------
    const HUB_DESC_MAX = 100;
    const hubDescription = (n) => {
      const s = snippetOf(n?.body ?? "");
      return s.length > HUB_DESC_MAX ? s.slice(0, HUB_DESC_MAX - 1) + "\u2026" : s;
    };
    // folder === null: every note; a folder id: that folder and below; "": only notes without a folder.
    function hubLines(notes, { folder = null, excludeId = "", withDesc = true, max = 100 } = {}) {
      const pick = notes
        .filter((n) => !n.trashed && n.id !== excludeId)
        .filter((n) => (folder === null ? true : folder === "" ? !cleanFolder(n.folder) : inFolder(cleanFolder(n.folder), folder)))
        .sort((a, b) => titleOf(a.body).localeCompare(titleOf(b.body)) || (a.id < b.id ? -1 : 1))
        .slice(0, max);
      return pick
        .map((n) => {
          const d = withDesc ? hubDescription(n) : "";
          return "- " + buildNoteLink(n.id, titleOf(n.body) || "Untitled note") + (d ? " - " + d : "");
        })
        .join("\n");
    }
    // A list item that holds nothing but one note link (a hub entry): the read view adds the description.
    const bareNoteLink = (nodes) => (Array.isArray(nodes) && nodes.length === 1 && nodes[0].t === "nl" ? nodes[0] : null);

    // ---- date notes: today / tomorrow / next work day, listed and filtered by date ----------------------
    const WEEKDAYS = Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
    const DATE_FOLDER = "daily";
    const DATE_MODES = Object.freeze(["separate", "single"]);
    const cleanDateMode = (v) => (DATE_MODES.includes(v) ? v : "separate");
    const ymdOf = (ms) => {
      const d = new Date(ms);
      return pad4(d.getFullYear()) + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    };
    // Local noon of a YYYY-MM-DD text (noon keeps daylight-saving shifts away from the date); 0 if invalid.
    function parseYmd(text) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? "").trim());
      if (!m) return 0;
      const y = +m[1], mo = +m[2], d = +m[3];
      if (y < 2000 || y > 2100) return 0;
      const t = new Date(y, mo - 1, d, 12);
      return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? t.getTime() : 0;
    }
    function shiftDays(ms, n) {
      const d = new Date(ms);
      d.setDate(d.getDate() + n);
      return d.getTime();
    }
    function nextWorkDay(ms) {
      let t = shiftDays(ms, 1);
      while ([0, 6].includes(new Date(t).getDay())) t = shiftDays(t, 1);
      return t;
    }
    const DATE_KINDS = Object.freeze([["today", "Today"], ["tomorrow", "Tomorrow"], ["next", "Next work day"]]);
    function dateTarget(kind, now) {
      const base = parseYmd(ymdOf(now));
      const ms = kind === "tomorrow" ? shiftDays(base, 1) : kind === "next" ? nextWorkDay(base) : base;
      return { ms, ymd: ymdOf(ms) };
    }
    const dateHeading = (ms) => ymdOf(ms) + " " + WEEKDAYS[new Date(ms).getDay()];
    const dateNoteBody = (ms) => "# " + dateHeading(ms) + "\n\n";
    const DATE_TITLE_RE = /^(\d{4}-\d{2}-\d{2})(?:\s|$)/;
    const dateOfNote = (n) => (n && !n.trashed ? DATE_TITLE_RE.exec(titleOf(n.body))?.[1] || "" : "");
    function findDateNote(notes, ymd) {
      const hits = notes.filter((n) => dateOfNote(n) === ymd);
      hits.sort((a, b) => b.updated - a.updated || (a.id < b.id ? -1 : 1));
      return hits[0] || null;
    }
    // Newest date first. "from" / "to" (YYYY-MM-DD) bound the list; a text filter matches the heading.
    function listDateNotes(notes, { from = "", to = "", text = "" } = {}) {
      const q = foldText(text).trim();
      return notes
        .map((n) => ({ ymd: dateOfNote(n), note: n }))
        .filter((x) => x.ymd && (!from || x.ymd >= from) && (!to || x.ymd <= to) && (!q || foldText(titleOf(x.note.body)).includes(q)))
        .sort((a, b) => (a.ymd < b.ymd ? 1 : a.ymd > b.ymd ? -1 : b.note.updated - a.note.updated));
    }
    // "All in one file" mode: one note called Journal, one "## YYYY-MM-DD Weekday" section per day.
    const JOURNAL_TITLE = "Journal";
    const isJournal = (n) => !!n && !n.trashed && titleOf(n.body).toLowerCase() === JOURNAL_TITLE.toLowerCase();
    const journalDays = (body) => [...String(body ?? "").matchAll(/^##\s+(\d{4}-\d{2}-\d{2})\b.*$/gm)].map((m) => m[1]);
    // Body with the day's section (added at the end when missing) and the caret position at the end of it.
    function journalSection(body, ymd, ms) {
      const text = String(body ?? "");
      const re = new RegExp("^##\\s+" + ymd + "\\b.*$", "m");
      const m = re.exec(text);
      if (!m) {
        const base = (text.trim() ? text.replace(/\s+$/, "") : "# " + JOURNAL_TITLE) + "\n\n## " + dateHeading(ms) + "\n\n";
        return { body: base, caret: base.length, created: true };
      }
      const from = m.index + m[0].length;
      const next = /^##\s/m.exec(text.slice(from));
      const end = next ? from + next.index : text.length;
      const trimmed = text.slice(from, end).replace(/\s+$/, "");
      return { body: text, caret: from + trimmed.length, created: false };
    }

    // ---- version history: rules only (the store does the file work) --------------------------------------
    const HISTORY_DIR = "history";
    const HISTORY_DEFAULTS = Object.freeze({ keep: 20, minutes: 10, capKB: 512, warnMB: 100 });
    const HISTORY_RANGE = Object.freeze({ keep: [1, 200], minutes: [1, 1440], capKB: [16, 4096], warnMB: [5, 2000] });
    function historyOptions(raw = {}) {
      const out = {};
      for (const k of Object.keys(HISTORY_DEFAULTS)) {
        const v = Number(raw?.[k]);
        out[k] = Number.isFinite(v) && raw?.[k] !== "" && raw?.[k] !== null ? clampInt(v, HISTORY_RANGE[k][0], HISTORY_RANGE[k][1]) : HISTORY_DEFAULTS[k];
      }
      return out;
    }
    const historyStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 15);
    function historyFileName(ms, taken = []) {
      const base = historyStamp(ms);
      let name = base + ".md";
      for (let i = 1; taken.includes(name) && i < 100; i++) name = base + "-" + i + ".md";
      return name;
    }
    function parseHistoryName(name) {
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:-(\d{1,2}))?\.md$/.exec(String(name ?? ""));
      if (!m) return 0;
      const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      return Number.isFinite(t) ? t : 0;
    }
    // Snapshot when the text changed, fits the size cap and the last snapshot is old enough.
    function shouldSnapshot({ lastMs = 0, now = 0, minutes = HISTORY_DEFAULTS.minutes, bytes = 0, capKB = HISTORY_DEFAULTS.capKB, same = false } = {}) {
      if (same || bytes <= 0 || bytes > capKB * 1024) return false;
      return !lastMs || now - lastMs >= minutes * 60000;
    }
    // Names to delete so at most `keep` remain (the newest are kept). Unknown names are never listed.
    function pruneHistory(entries, keep) {
      return entries
        .filter((e) => e && parseHistoryName(e.name))
        .sort((a, b) => parseHistoryName(b.name) - parseHistoryName(a.name) || (a.name < b.name ? 1 : -1))
        .slice(Math.max(1, keep))
        .map((e) => e.name);
    }
    function historyWarning({ bytes = 0, warnMB = HISTORY_DEFAULTS.warnMB } = {}) {
      return bytes >= warnMB * 1048576 ? "Version history now takes " + (bytes / 1048576).toFixed(1) + " MB (warning at " + warnMB + " MB). Lower the number of versions or clear old history." : "";
    }

    // ---- [[ completion while typing ------------------------------------------------------------------------
    function wikiTrigger(value, caret) {
      const before = String(value).slice(Math.max(0, caret - 130), caret);
      const m = /\[\[([^\[\]\n|]{0,120})$/.exec(before);
      return m ? { start: caret - m[0].length, query: m[1] } : null;
    }
    function wikiComplete(value, trigger, caret, title) {
      const t = cleanLinkLabel(title).replace(/\|/g, "/"); // a pipe would start the alias part
      const end = String(value).slice(caret, caret + 2) === "]]" ? caret + 2 : caret;
      const text = "[[" + t + "]]";
      return { start: trigger.start, end, text, selStart: trigger.start + text.length, selEnd: trigger.start + text.length };
    }

    // ---- Zen sidebar folder (experiment): what to show, and how a tab maps back to a note ----------------------
    // The reserved folder "tabbar" is the counterpart of the bookmarks toolbar folder: in mode "selected" only what
    // is inside it appears in Zen's pinned-tabs folder tree; in mode "all" the whole notes tree does.
    const TABBAR_FOLDER = "tabbar";
    const TABBAR_LABEL = "Notes (tabbar)";
    const ZEN_MODES = Object.freeze(["off", "selected", "all"]);
    const cleanZenMode = (v) => (ZEN_MODES.includes(v) ? v : "off");
    const ZEN_MAX_ENTRIES = 200;
    const ZEN_URL_PREFIX = "about:blank#zn-";
    const zenNoteUrl = (id) => ZEN_URL_PREFIX + "note:" + encodeURIComponent(id);
    const zenNewUrl = (folderId) => ZEN_URL_PREFIX + "new:" + encodeURIComponent(cleanFolder(folderId));
    // Our own tab URLs only (about:blank#zn-note:<id> / #zn-new:<folder>); everything else is null.
    function parseZenUrl(url) {
      const m = /^about:blank#zn-(note|new):([A-Za-z0-9%._~-]{0,300})$/.exec(String(url ?? ""));
      if (!m) return null;
      let v;
      try {
        v = decodeURIComponent(m[2]);
      } catch (_) {
        return null;
      }
      if (m[1] === "note") return NOTE_ID_RE.test(v) && !v.includes("..") ? { kind: "note", id: v } : null;
      return cleanFolder(v) === v ? { kind: "new", folder: v } : null;
    }
    // Tree -> flat ordered entries. mode "all": everything; "selected": only the tabbar folder's content, whose direct
    // children sit right inside the Zen NOTES folder (parent ""); "off": nothing. Parents always come before children.
    function projectZen(notes, folders, mode = "all", order = "folders-first") {
      mode = cleanZenMode(mode);
      if (mode === "off") return [];
      let root = buildTree(notes, folders);
      if (mode === "selected") {
        root = root.children.find((c) => c.id === TABBAR_FOLDER);
        if (!root) return [];
      }
      const out = [];
      // Same order as the sheet's tree (childSequence); a parent always comes before its children, and entries that
      // share a parent appear in the order the person sees them in Notes.
      const walk = (node, parent) => {
        for (const m of childSequence(node, order, true)) {
          if (m.folder) {
            const key = projKey("folder", m.folder.id);
            out.push({ key, kind: "folder", id: m.folder.id, label: m.folder.label, parent, color: m.folder.color || "" });
            walk(m.folder, key);
          } else out.push({ key: projKey("note", m.note.id), kind: "note", id: m.note.id, label: titleOf(m.note.body) || "Untitled note", parent, color: m.note.color || "" });
        }
      };
      walk(root, "");
      return out.slice(0, ZEN_MAX_ENTRIES);
    }
    // Which parents hold their entries in a different order than wanted. `current` is in browser order. Only keys found
    // on both sides are compared (missing ones are added/removed by diffProjection), so this is safe to run after it.
    function orderPlan(current, wanted) {
      const wantBy = new Map();
      for (const e of wanted) {
        if (!wantBy.has(e.parent)) wantBy.set(e.parent, []);
        wantBy.get(e.parent).push(e.key);
      }
      const have = new Map();
      for (const e of current) {
        if (!have.has(e.parent)) have.set(e.parent, []);
        have.get(e.parent).push(e.key);
      }
      const out = [];
      for (const [parent, keys] of wantBy) {
        const present = new Set(have.get(parent) || []);
        const want = keys.filter((k) => present.has(k));
        const now = (have.get(parent) || []).filter((k) => keys.includes(k));
        if (want.length > 1 && want.some((k, i) => k !== now[i])) out.push({ parent, keys: want });
      }
      return out;
    }

    // UTF-8 byte count of a text (used by version history to enforce the per-snapshot size cap).
    function utf8Bytes(s) {
      const out = [];
      for (const ch of String(s)) {
        let c = ch.codePointAt(0);
        if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return Uint8Array.from(out);
    }
    /* ---- NOT ACTIVE CODE: kept for a possible future sync through a linked GitHub repository --------------------------
     * Notes are NOT synced through Zen Sync / pinned-tab addresses. That idea was designed, then rejected for good (an address
     * holds ~1.4 KB, Sync would have to carry note text, the limits make it a bad fit). Do not rebuild it.
     * What follows is only the merge decision any future file-based sync (for example notes <-> a git repository) would need:
     * given the local note, the incoming copy and whether the local one has unsaved edits, say what to do. Rules: never delete,
     * unsaved local edits and a newer local note win, a trashed local note is never resurrected, an older local note is replaced
     * and the replaced text is backed up first. It is unused and has no test; before using it, write its tests back.
     *
     * function mergeRemote(local, remote, { dirty = false } = {}) {
     *   if (!local) return { action: "create" };
     *   if (local.trashed) return { action: "skip" };
     *   if (dirty) return { action: "keep-local", push: true };
     *   if (remote.updated > local.updated) return { action: "update", backup: local.body !== remote.body };
     *   if (remote.updated === local.updated) return { action: "same" };
     *   return { action: "keep-local", push: true };
     * }
     */

    // ---- debug sampler (pref off by default): per-name count / total / max of performance.now() ----------------
    function createPerfSampler({ now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()), enabled = () => false, maxNames = 64 } = {}) {
      const rows = new Map();
      const add = (name, ms) => {
        let r = rows.get(name);
        if (!r) {
          if (rows.size >= maxNames) return;
          r = { n: 0, total: 0, max: 0 };
          rows.set(name, r);
        }
        r.n++;
        r.total += ms;
        if (ms > r.max) r.max = ms;
      };
      return {
        wrap(name, fn) {
          return function (...args) {
            if (!enabled()) return fn.apply(this, args);
            const t = now();
            try {
              return fn.apply(this, args);
            } finally {
              add(name, now() - t);
            }
          };
        },
        rows: () => [...rows].map(([name, r]) => ({ name, n: r.n, total: r.total, avg: r.n ? r.total / r.n : 0, max: r.max })).sort((a, b) => b.total - a.total),
        reset: () => rows.clear(),
        report() {
          const list = this.rows();
          return list.length ? list.map((r) => r.name + ": " + r.n + " calls, avg " + r.avg.toFixed(2) + " ms, max " + r.max.toFixed(2) + " ms, total " + r.total.toFixed(1) + " ms").join("\n") : "(no samples)";
        },
      };
    }

    // One sampler for the whole file; it records nothing while the debug_perf preference is off.
    let PERF_ON = false;
    const PERF = createPerfSampler({ enabled: () => PERF_ON });
    // ---- Zen sidebar folder controller (experiment, off by default; the browser is reached ONLY through `api`) ----
    // Order of work on every run: read the mode, build the wanted list with projectZen, diff it against what the
    // folder holds (only tabs that carry our marker), apply the difference. Any exception switches the whole
    // controller off (kill switch) and leaves what exists as inert pinned about:blank tabs. Never touches other tabs.
    function createZenFolder({ api, store, getMode, getOrder = () => "folders-first", getNewButtons = () => false, now = () => Date.now(), setTimer, clearTimer, warn = () => {}, onKill = () => {} }) {
      let dead = false;
      let orderOk = true; // set to false once if the browser refuses to reorder (we then stop trying, nothing else changes)
      let touches = []; // timestamps of browser-side requests (a tab was closed, moved, unpinned...), see touch()
      let timer = null;
      let flat = null; // null = not tried, true = nested folders unavailable (labels carry the path), false = nested works
      const kill = (error) => {
        if (dead) return;
        dead = true;
        if (timer !== null) clearTimer(timer);
        timer = null;
        try { warn(error); } catch (_) {}
        try { onKill(error); } catch (_) {}
      };
      const flatten = (want) => {
        const byKey = new Map(want.map((e) => [e.key, e]));
        return want
          .filter((e) => e.kind === "note")
          .map((e) => {
            const path = [];
            for (let p = e.parent, g = 0; p && g < 8; g++) {
              const f = byKey.get(p);
              if (!f) break;
              path.unshift(f.label);
              p = f.parent;
            }
            return { ...e, parent: "", label: (path.length ? path.join(" / ") + " / " : "") + e.label };
          });
      };
      function rebuild() {
        if (dead) return;
        const mode = cleanZenMode(getMode());
        if (mode === "off") {
          if (api.hasRoot()) api.removeAll();
          return;
        }
        if (!api.ready()) return;
        if (mode === "selected") store.ensureTabbarFolder();
        if (!api.ensureRoot()) return;
        if (api.sweepStrays) api.sweepStrays(); // our tabs that ended up outside the NOTES folder (unpinned, essential, dragged away, restored)
        const notes = store.list();
        let want = projectZen(notes, store.meta.folders, mode, getOrder());
        if (flat === true) want = flatten(want);
        const plan = diffProjection(api.list(), want);
        for (const key of plan.remove) api.remove(key.split("#")[0], key.includes("#dup"));
        for (const e of plan.add) {
          if (!api.add(e, e.kind === "note" ? zenNoteUrl(e.id) : "")) {
            if (e.kind === "folder" && flat === null) { flat = true; return rebuild(); }
            continue;
          }
          if (e.kind === "folder" && flat === null) flat = false;
        }
        for (const r of plan.relabel) api.relabel(r.key, r.label);
        for (const m of plan.move) api.move(m.key, m.parent);
        if (plan.move.length && timer === null) timer = setTimer(run, 0);
        // Same order as the sheet's tree. Skipped while moves are pending (the follow-up run does it) and for good
        // after the first refusal, so a browser that cannot reorder never causes a loop.
        if (!plan.move.length && orderOk && api.reorder) {
          for (const o of orderPlan(api.list(), want)) {
            if (api.reorder(o.parent, o.keys) === false) { orderOk = false; warn("Zen folder: the browser would not reorder the entries; order is left as created"); break; }
          }
        }
        // "New note" entry: once in the root and once in every sub-folder that exists now (path labels have no sub-folders).
        if (!plan.move.length && api.syncNewButtons) api.syncNewButtons(want.filter((e) => e.kind === "folder"), !!getNewButtons());
      }
      function run() {
        timer = null;
        if (dead) return;
        try { api.busy?.(true); rebuild(); } catch (error) { kill(error); } finally { try { api.busy?.(false); } catch (_) {} }
      }
      return {
        // Coalesced: any number of requests inside the delay make one run (no polling, no retry loop).
        schedule(ms = 250) {
          if (dead || timer !== null) return;
          timer = setTimer(run, ms);
        },
        runNow: run,
        // A request that comes from the BROWSER side (someone closed, moved, unpinned or discarded one of our tabs, or
        // an add-on did it to every tab). Coalesced like schedule(), and rate limited: more than 12 in a minute are
        // ignored until the minute is over, so a script or add-on that keeps touching our tabs cannot start a loop.
        // Requests from the notes themselves (schedule) are never limited.
        touch(ms = 400) {
          if (dead) return false;
          const t = now();
          touches = touches.filter((x) => t - x < 60000);
          if (touches.length >= 12) return false;
          touches.push(t);
          if (timer === null) timer = setTimer(run, ms);
          return true;
        },
        kill,
        get dead() { return dead; },
        get flat() { return flat; },
        destroy() {
          dead = true;
          if (timer !== null) clearTimer(timer);
          timer = null;
        },
      };
    }

    if (window.__zentralNotesTestSeam) {
      window.__zentralNotesTestSeam.core = {
        DOCK_MODES, cleanDockMode, hoverStripPx, hoverTiming, hoverMayClose, HOVER_CLOSE_GRACE_MS,
        makeId, parseNoteText, noteFromFile, serializeNote, titleOf, snippetOf,
        wordCount, counterText, TEMPLATE_FOLDER, BUILTIN_TEMPLATES, templateNeedsTitle, applyTemplate, templateChoices, findBrokenLinks, unlinkBroken, CAPTURE_FORMATS, cleanCaptureFormat, captureLine, insertLineAt, DEMO_NOTES, DEMO_FOLDER, demoTitle, labelSummary, NOTE_COLORS, HIGHLIGHT_COLORS, spellcheckOn, outlineItems, stripModel, READ_WPM, trashPlan, trashBanner, cleanTrashDays, safeFileName, createAutosaver, parseInline, parseBlocks,
        wrapSelection, toggleLinePrefix, continueList, toggleCheckboxLine, toggleTableBox, splitRowSpans, TASK_STATUSES, TASK_CYCLE, setLineTaskStatus, cycleTaskStatus, setTaskStatus, setHeadingLevel, insertRule, nestLines,
        diffSigs, blockSig, exportHtml, exportText, uniqueFileNames, EXPORT_FORMATS,
        projectNotesFolder, diffProjection, planCleanup, dropDecision, urlNoteBody, NOTES_ATTR, exportBody, noteLinkTarget, buildNoteLink, insertNoteLink, expandWikiLinks, rewriteNoteLinks, findBacklinks, noteLinksIn, resolveNoteTitle, mapOutsideCode,
        createStore, safeHref, FILE_RE, createSheet, parseShortcut, matchesShortcut, menuPosition,
        highlightCode, codeLangKey, texNodes, mapPosition, mergeAnchors, insertCodeBlock, buildLink, insertLink,
        pastedLink, fragmentLabel, insertImage, makeTable, insertTable, SHORTCUT_ACTIONS, formatCombo,
        normalizeCombo, comboFromEvent, parseShortcutMap, effectiveShortcuts, findShortcutConflict,
        matchShortcutAction, assignShortcut, QUICK_OPTIONS, stepOption, PREF,
        alignDelim, buildImage, insertImageMd, pastedWebAddress, CODE_LANGS, CALLOUT_KINDS, calloutId, insertCallout,
        HIDEABLE_TOOLS, parseHidden, serializeHidden,
        normalizeGeo, clampGeo, moveGeo, resizeGeo, placeSheet, keepClear, clearOfRect, sideOf, createHoldAction,
        pushRecent, cleanRecent, GEO_MIN, RESIZE_HANDLES,
        cleanLabel, NOTE_THEMES, normalizeTheme, pushAmount,
        clampShare, slotShare, slotPx, clampSlotPx, gapEdgeDrag, panelSpansFullHeight, dockBandTop, slotDragShare, followTarget, pagesWithoutSlotHeight, SLOT_MIN_SHARE, SLOT_MAX_SHARE, SLOT_LARGE_SHARE,
        FOLDER_SEG_RE, FOLDER_MAX_DEPTH, MAX_FOLDERS, cleanFolder, parentOfFolder, sortNotes, buildTree, cleanFolders, slugFolder,
        allFolderIds, moveNote, addFolderMeta, patchFolderMeta, deleteFolder, reparentFolder, treeRows, TREE_ORDERS, cleanTreeOrder, DEFAULT_VIEWS, cleanDefaultView, startMode, fitDialog,
        lookOverrides, LOOK_NUM_PREFS, hexToHsl, hslToHex, cssColorToHex, SETTINGS_TABS, WRITING_OPTIONS, QUICK_IDS, LOOK_VARS, LOOK_FONTS, LOOK_PREFS, buildCapture, insertCapture, captureFragmentUrl, findInbox,
        CAPTURE_STYLES, CAPTURE_TARGETS, CAPTURE_DEFAULTS, cleanCaptureText,
        foldText, normalizeFindQuery, findMatches, highlightSegments, findInRuns, searchOtherNotes, stepMatchIndex, firstMatchFrom, lineOfOffset, revealScroll,
        FIND_MAX_MATCHES, FIND_MAX_QUERY, sniffImageMime, checkAssetBytes, assetFileName, parseAssetLink, buildAssetLink, buildAssetImage,
        insertAssetImage, assetImageAt, restyleAssetImage, assetRefs, isAssetNoteId, ASSET_MAX_BYTES, ASSET_MAX_PER_NOTE, ASSET_MIME,
        cleanRemind, ceilStep, dueReminders, nextReminderAt, reminderDelay, reminderPresets, parseRemindInput, remindPreview, remindDateText, remindTimeText,
        createReminderScheduler, REMIND_STEP_MS, SNOOZE_CHOICES, MAX_TIMER_MS,
        headingSlug, headingsOf, cleanAnchor, noteLinkParts, headingOffset, insertFootnote, nextFootnoteLabel, mentionRe, hasMention, linkFirstMention,
        hubDescription, hubLines, bareNoteLink, DATE_FOLDER, DATE_KINDS, DATE_MODES, cleanDateMode, ymdOf, parseYmd, shiftDays, nextWorkDay, dateTarget, dateHeading, dateNoteBody,
        dateOfNote, findDateNote, listDateNotes, JOURNAL_TITLE, isJournal, journalDays, journalSection,
        HISTORY_DIR, HISTORY_DEFAULTS, HISTORY_RANGE, historyOptions, historyStamp, historyFileName, parseHistoryName, shouldSnapshot, pruneHistory, historyWarning,
        orderPlan, childSequence, wikiTrigger, wikiComplete, TABBAR_FOLDER, TABBAR_LABEL, ZEN_MODES, cleanZenMode, ZEN_MAX_ENTRIES, zenNoteUrl, zenNewUrl, parseZenUrl, projectZen,
        utf8Bytes, createPerfSampler, createZenFolder,
      };
    }

    // ======================================================================
    // UI helpers (DOM is only ever built with createElement / textContent)
    // ======================================================================
    const SVG_NS = "http://www.w3.org/2000/svg";
    const ICONS = {
      note: "M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z M15 3v6h6",
      list: "M4 6h16M4 12h16M4 18h16",
      plus: "M12 5v14M5 12h14",
      x: "M18 6 6 18M6 6l12 12",
      pin: "M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
      trash: "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
      more: "M5 12h.01M12 12h.01M19 12h.01",
      bold: "M6 4h8a4 4 0 0 1 0 8H6z M6 12h9a4 4 0 0 1 0 8H6z",
      italic: "M19 4h-9 M14 20H5 M15 4 9 20",
      strike: "M16 4H9a3 3 0 0 0-2.83 4 M14 12a4 4 0 0 1 0 8H6 M4 12h16",
      highlight: "m9 11-6 6v3h9l3-3 M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
      check: "m9 11 3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
      bullets: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
      heading: "M6 12h12 M6 20V4 M18 20V4",
      eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
      edit: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
      maximize: "M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3",
      minimize: "M8 3v3a2 2 0 0 1-2 2H3 M21 8h-3a2 2 0 0 1-2-2V3 M3 16h3a2 2 0 0 1 2 2v3 M16 21v-3a2 2 0 0 1 2-2h3",
      search: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M21 21l-4.3-4.3",
      back: "M19 12H5 M12 19l-7-7 7-7",
      save: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
      copy: "M8 8h12v12H8z M4 16V4h12",
      folder: "M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
      restore: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5",
      duplicate: "M9 9h11v11H9z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
      caret: "m6 9 6 6 6-6",
      chevron: "m9 6 6 6-6 6",
      columns: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M12 3v18",
      image: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21",
      rule: "M4 12h16",
      quote: "M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z",
      indent: "M3 8l4 4-4 4 M21 12H11 M21 6H11 M21 18H11",
      outdent: "M7 8l-4 4 4 4 M21 12H11 M21 6H11 M21 18H11",
      link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
      code: "m16 18 6-6-6-6 M8 6l-6 6 6 6",
      codeblock: "M4 4h16v16H4z M10 9l-3 3 3 3 M14 9l3 3-3 3",
      numbered: "M10 6h11 M10 12h11 M10 18h11 M4 6h1v4 M4 10h2 M4 14.5a1.5 1 0 0 1 3 0c0 1-3 2-3 3.5h3",
      table: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 10h18 M3 15h18 M9 3v18 M15 3v18",
      bookmark: "m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z",
      hover: "M4 4l7.07 16.97 2.51-7.39 7.39-2.51L4 4z",
      dock: "M3 4h18v16H3z M3 14h18",
      noteBetween: "M5 3h14 M5 21h14 M5 8h14v8H5z M9 12h6",
      bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0",
      sliders: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
    };
    function icon(name, size = 14) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", name === "more" ? "3" : "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", ICONS[name] || "");
      svg.appendChild(path);
      return svg;
    }
    function h(tag, attrs, ...kids) {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v === false || v === null || v === undefined) continue;
        if (k === "class") node.className = v;
        else node.setAttribute(k, v === true ? "" : String(v));
      }
      for (const kid of kids)
        if (kid !== null && kid !== undefined && kid !== false)
          node.append(typeof kid === "string" ? document.createTextNode(kid) : kid);
      return node;
    }
    function iconButton(name, title, cls = "") {
      const b = h("button", {
        type: "button",
        class: ("zn-btn " + cls).trim(),
        title,
        "aria-label": title,
      });
      b.appendChild(icon(name));
      return b;
    }
    function relativeTime(t) {
      const d = new Date(t),
        n = new Date();
      if (d.toDateString() === n.toDateString())
        return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(d.getFullYear() === n.getFullYear() ? {} : { year: "2-digit" }),
      });
    }

    function renderInline(parent, nodes, env) {
      for (const n of nodes) {
        if (n.t === "text") parent.append(document.createTextNode(n.s));
        else if (n.t === "br") parent.append(document.createElement("br"));
        else if (n.t === "task") {
          // A task box inside a table cell: a click flips exactly that box in the source (read mode only).
          const box = h("button", { type: "button", class: "zn-check zn-cell-check", role: "checkbox", "aria-checked": n.on ? "true" : "false", "aria-label": "Toggle item" });
          if (n.on) box.dataset.on = "true";
          if (n.line < 0 || !env.tableToggle) box.disabled = true;
          else box.addEventListener("click", () => env.tableToggle(n.line, n.col, n.k));
          parent.append(box, document.createTextNode(" "));
        } else if (n.t === "nl") {
          // Link to another note: no address at all, so nothing can be fetched or navigated. A click opens the note.
          const info = env.noteInfo ? env.noteInfo(n.id) : null;
          const node = h("span", { class: "zn-link zn-notelink" + (info ? (info.trashed ? " is-trashed" : "") : " is-missing"), role: "link", tabindex: "0" });
          node.dataset.noteId = n.id;
          node.title = info ? (info.trashed ? "In the trash: " : "Note: ") + info.title : "This note no longer exists";
          const go = (e) => {
            e.preventDefault();
            env.openNoteLink?.(n.id, n.heading || "");
          };
          node.addEventListener("click", go);
          node.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") go(e);
          });
          renderInline(node, n.c, env);
          parent.append(node);
        } else if (n.t === "fn") {
          // Footnote number: a click jumps to the footnote at the end of the note (no address, nothing navigates).
          const sup = h("sup", { class: "zn-fn" });
          const a = h("span", { class: "zn-link zn-fnref", role: "link", tabindex: "0", title: "Footnote " + n.n }, String(n.n));
          a.dataset.fnref = n.label;
          const go = (e) => {
            e.preventDefault();
            env.jumpFootnote?.(n.label, false, a);
          };
          a.addEventListener("click", go);
          a.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") go(e);
          });
          sup.append(a);
          parent.append(sup);
        } else if (n.t === "img" && n.asset) {
          // A picture from this note's own asset folder: read through env.loadAsset (validated path, local file),
          // never through a network address. A missing or unreadable file shows a quiet placeholder.
          const wrap = h("span", { class: "zn-pic", "data-align": n.align || "" });
          const holder = h("span", { class: "zn-pic-missing" });
          holder.append(icon("image", 12), h("span", {}, n.alt || "picture"));
          holder.title = "Loading picture\u2026";
          wrap.append(holder);
          const load = env.loadAsset ? Promise.resolve(env.loadAsset(n.asset)) : Promise.resolve(null);
          load.then((got) => {
            if (!got?.url) { holder.title = "Picture not found: " + n.asset; return; }
            const img = h("img", { class: "zn-img-loaded zn-pic-img", alt: n.alt, src: got.url });
            if (n.width) img.style.maxWidth = n.width + "px";
            if (n.width) img.style.width = n.width + "px";
            holder.replaceWith(img);
            if (got.release) env.trackAsset?.(got.release);
          }).catch(() => { holder.title = "Picture not found: " + n.asset; });
          parent.append(wrap);
        } else if (n.t === "img") {
          // Nothing is fetched until the person clicks: opening a note must not contact a server.
          const btn = h("button", { type: "button", class: "zn-img", title: "Load image: " + n.href });
          btn.append(icon("image", 12), h("span", {}, n.alt || "image"));
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const img = h("img", { class: "zn-img-loaded", alt: n.alt, src: n.href, loading: "lazy" });
            btn.replaceWith(img);
          });
          parent.append(btn);
        } else if (n.t === "code" || n.t === "kbd") {
          const c = h(n.t === "kbd" ? "kbd" : "code");
          c.textContent = n.s;
          parent.append(c);
        } else {
          const tag = { b: "strong", i: "em", s: "del", hl: "mark", a: "span", sub: "sub", sup: "sup", math: "span" }[n.t];
          if (!tag) continue;
          const node = h(tag);
          if (n.t === "math") node.className = "zn-math";
          else if (n.t === "hl") {
            node.className = "zn-hl";
            node.dataset.color = n.color;
          } else if (n.t === "a") {
            // No href attribute: a real link inside browser chrome could
            // navigate the window. Clicks go through env.openLink instead.
            node.className = "zn-link";
            node.dataset.href = n.href;
            node.setAttribute("role", "link");
            node.setAttribute("tabindex", "0");
            node.title = n.title ? n.title + "\n" + n.href : n.href;
            node.addEventListener("click", (e) => {
              e.preventDefault();
              env.openLink(n.href);
            });
            node.addEventListener("keydown", (e) => {
              if (e.key === "Enter") env.openLink(n.href);
            });
          }
          renderInline(node, n.c, env);
          parent.append(node);
        }
      }
    }
    function renderBlocks(parent, blocks, env, onToggle) {
      for (const b of blocks) {
        if (b.type === "h") {
          const node = h("h" + b.level, { class: "zn-h" });
          renderInline(node, b.c, env);
          node.dataset.slug = env.slugFor ? env.slugFor(node.textContent) : headingSlug(node.textContent);
          parent.append(node);
        } else if (b.type === "footnotes") {
          const list = h("ol", { class: "zn-footnotes" });
          for (const it of b.items) {
            const li = h("li", { class: "zn-footnote" });
            li.dataset.fn = it.label;
            renderInline(li, it.c, env);
            const back = h("span", { class: "zn-link zn-fnback", role: "link", tabindex: "0", title: "Back to the text" }, "\u21a9");
            const go = (e) => {
              e.preventDefault();
              env.jumpFootnote?.(it.label, true, back);
            };
            back.addEventListener("click", go);
            back.addEventListener("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") go(e);
            });
            li.append(" ", back);
            list.append(li);
          }
          parent.append(h("hr", { class: "zn-hr" }), list);
        } else if (b.type === "p") {
          const node = h("p", { class: "zn-p" });
          renderInline(node, b.c, env);
          parent.append(node);
        } else if (b.type === "math") {
          const node = h("div", { class: "zn-math zn-math-block" });
          renderInline(node, b.c, env);
          parent.append(node);
        } else if (b.type === "details") {
          // A button + div instead of a native <details>: same behaviour in chrome and in the tests, and the
          // open state is only view state (it is not saved in the note).
          const box = h("div", { class: "zn-details" });
          const body = h("div", { class: "zn-details-body" });
          const head = h("button", { type: "button", class: "zn-details-sum", "aria-expanded": b.open ? "true" : "false" });
          const label = h("span", { class: "zn-details-label" });
          if (b.summary.length) renderInline(label, b.summary, env);
          else label.textContent = "Details";
          head.append(h("span", { class: "zn-details-arrow", "aria-hidden": "true" }), label);
          body.hidden = !b.open;
          head.addEventListener("click", (e) => {
            e.stopPropagation();
            const on = head.getAttribute("aria-expanded") !== "true";
            head.setAttribute("aria-expanded", on ? "true" : "false");
            body.hidden = !on;
          });
          renderBlocks(body, b.blocks, env, onToggle);
          box.append(head, body);
          parent.append(box);
        } else if (b.type === "gap") {
          const gap = h("div", { class: "zn-gap", "aria-hidden": "true" });
          gap.style.setProperty("--n", String(Math.min(b.n, 20)));
          parent.append(gap);
        } else if (b.type === "hr") parent.append(h("hr", { class: "zn-hr" }));
        else if (b.type === "code") {
          const code = h("code");
          if (codeLangKey(b.lang)) {
            for (const tk of highlightCode(b.text, b.lang)) {
              if (!tk.k) code.append(document.createTextNode(tk.s));
              else {
                const span = h("span", { class: "zn-tk" });
                span.dataset.k = tk.k;
                span.textContent = tk.s;
                code.append(span);
              }
            }
          } else code.textContent = b.text;
          const pre = h("pre", { class: "zn-pre" }, code);
          if (b.lang) pre.dataset.lang = b.lang;
          parent.append(pre);
        } else if (b.type === "table") {
          const table = h("table", { class: "zn-table" });
          const row = (tag, cells) => {
            const tr = h("tr");
            cells.forEach((c, i) => {
              const cell = h(tag);
              if (b.align[i]) cell.style.textAlign = b.align[i];
              renderInline(cell, c, env);
              tr.append(cell);
            });
            return tr;
          };
          table.append(h("thead", {}, row("th", b.head)), h("tbody", {}, ...b.rows.map((r) => row("td", r))));
          parent.append(h("div", { class: "zn-table-wrap" }, table));
        } else if (b.type === "quote") {
          const node = h("blockquote", { class: b.callout ? "zn-quote zn-callout" : "zn-quote" });
          if (b.callout) {
            node.dataset.kind = b.callout.kind;
            node.append(h("div", { class: "zn-callout-title" }, b.callout.title || b.callout.kind[0].toUpperCase() + b.callout.kind.slice(1)));
          }
          renderBlocks(node, b.blocks, env, onToggle);
          parent.append(node);
        } else if (b.type === "list") {
          for (const item of b.items) {
            const row = h("div", { class: "zn-li" });
            row.style.setProperty("--lvl", String(item.level));
            let marker;
            if (item.checked === null) marker = h("span", { class: "zn-marker" }, item.marker);
            else {
              marker = h("button", {
                type: "button",
                class: "zn-check",
                role: "checkbox",
                "aria-checked": item.checked ? "true" : "false",
                "aria-label": "Toggle item",
              });
              if (item.checked) marker.dataset.on = "true";
              if (item.status) {
                marker.dataset.status = item.status;
                marker.title = TASK_STATUS_NAMES[item.status] || "";
                marker.textContent = TASK_STATUS_MARKS[item.status] || "";
              }
              if (item.status === "-") marker.setAttribute("aria-checked", "mixed");
              marker.title = (item.status ? (TASK_STATUS_NAMES[item.status] || "") + ". " : "") + "Click: done. Right-click: next state. Hold: pick a state.";
              if (item.line < 0) marker.disabled = true;
              else {
                // Tap = done / not done (as before). Right click cycles ? ! / - (like flags in Minesweeper). Holding the
                // button opens the list of states. The click that ends a hold is swallowed by createHoldAction.
                const hold = createHoldAction({ setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: (id) => window.clearTimeout(id), onTap: () => onToggle(item.line), onHold: () => env.taskMenu?.(item.line, marker) });
                marker.addEventListener("pointerdown", (e) => { if (e.button === undefined || e.button === 0) hold.press(); });
                marker.addEventListener("pointerup", () => hold.release());
                marker.addEventListener("pointerleave", () => hold.cancel());
                marker.addEventListener("click", () => hold.click());
                marker.addEventListener("contextmenu", (e) => { e.preventDefault(); hold.cancel(); env.taskCycle?.(item.line); });
              }
            }
            const text = h("span", { class: "zn-li-text" });
            if (item.checked || item.status === "-") text.dataset.done = "true";
            renderInline(text, item.c, env);
            // A hub entry (a list item that is only a link to another note) shows that note's short description.
            const bare = env.hubDescriptions?.() ? bareNoteLink(item.c) : null;
            const desc = bare && env.noteInfo ? env.noteInfo(bare.id)?.desc : "";
            if (desc) text.append(h("span", { class: "zn-hubdesc" }, " \u2014 " + desc));
            row.append(marker, text);
            parent.append(row);
            for (const para of item.more || []) {
              const more = h("p", { class: "zn-li-more" });
              more.style.setProperty("--lvl", String(item.level));
              renderInline(more, para, env);
              parent.append(more);
            }
          }
        }
      }
    }

    // ======================================================================
    // Sheet: one editor view; many can exist, all bound to the same store
    // ======================================================================
    function createSheet({ store, adapter, env, ensureStore }) {
      const token = {};
      const cleanups = [];
      const listen = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        cleanups.push(() => target.removeEventListener(type, fn, opts));
      };
      let currentId = "";
      let view = "editor"; // editor | list
      let mode = "edit"; // edit | read | split
      let filter = "all"; // all | recent | trash
      let query = "";
      let isOpen = false;
      let typed = false;
      let menu = null;
      let rafChrome = 0,
        rafList = 0,
        rafLayout = 0;
      let unwatch = null;
      let confirmTimer = 0;
      let destroyed = false;
      let previewTimer = 0; // armed only while split view waits for typing to pause
      let flashTimer = 0; // armed only while a short message is showing
      let flashMsg = "";
      let readAnch = []; // [{ line, node }] first node of each block / list item, for linked scrolling
      let readAnchY = null; // the same with measured offsets; dropped whenever the pane changes
      let taAnchY = null; // source line -> editor offset (measured lazily with a hidden mirror)
      let mirror = null;
      let readSigs = []; // signatures of the blocks drawn in the read/preview pane
      let readNodes = []; // DOM nodes per drawn block
      let readEmpty = false;
      let dialog = null; // export notice
      let collapsed = false; // hover mode: open but folded away; only the thin real strip stays in layout
      let revealEl = null;
      let openTimer = 0; // armed only while the pointer rests on the strip
      let graceTimer = 0; // armed only while a hover-opened sheet waits to fold away
      let ptrDown = false;
      let ptrInside = false;
      let findOpen = false; // find bar (P2)
      let findList = []; // matches in the pane being searched
      let findRuns = null; // read pane: text nodes behind findList
      let findIdx = -1;
      let findAnchor = 0; // where a new search starts looking (caret when the bar opened)
      let findOtherIds = [];
      let findTimer = 0;
      let remindTick = 0;

      // ---- DOM -----------------------------------------------------------
      const root = h("div", {
        class: "zentral-notes-sheet",
        role: "dialog",
        "aria-label": "Notes",
      });
      root.hidden = true;
      const btnList = iconButton("list", "All notes (Ctrl+K)", "zn-list-btn");
      const titleEl = h("button", { type: "button", class: "zn-title", title: "All notes" });
      const btnPin = iconButton("bookmark", "Pin note to the top of the list");
      // The window pin works like the pin of a Zentral panel: pinned = stays open, unpinned = closes on an
      // outside click. Hold it to put the window back in its default place.
      const btnKeep = iconButton("pin", "Keep open", "zn-keep-btn");
      // Panel docking modes (same wording as the panel's own docking / autohide buttons).
      const btnHover = iconButton("hover", "Autohide: show Notes on hover at its docked edge", "zn-hover-btn");
      const btnDock = iconButton("dock", "Dock: Notes keeps its own space", "zn-dock-btn");
      const colorDot = h("span", { class: "zn-dot" });
      const btnColor = h("button", {
        type: "button",
        class: "zn-btn",
        title: "Note color",
        "aria-label": "Note color",
      });
      btnColor.append(colorDot);
      const btnSize = iconButton("maximize", "Larger (hold: fill the whole area)");
      const btnMore = iconButton("more", "More");
      const btnClose = iconButton("x", "Close notes (Esc)");
      const labelEl = h("button", { type: "button", class: "zn-label", title: "Edit label" });
      labelEl.hidden = true;
      const remindEl = h("button", { type: "button", class: "zn-remind", title: "Reminder" });
      remindEl.hidden = true;
      const head = h("div", { class: "zn-head" }, btnList, titleEl, labelEl, remindEl, btnPin, btnColor, btnKeep, btnHover, btnDock, btnSize, btnMore, btnClose);

      const tBold = iconButton("bold", "Bold (Ctrl+B)");
      const tItalic = iconButton("italic", "Italic (Ctrl+I)");
      const tStrike = iconButton("strike", "Strikethrough");
      const tHl = iconButton("highlight", "Highlight selection (Ctrl+Shift+H)", "zn-hl-btn");
      const hlDot = h("span", { class: "zn-hl-dot" });
      tHl.append(hlDot);
      const tHlMenu = iconButton("caret", "Highlight color", "zn-caret");
      const tHeading = iconButton("heading", "Heading (hold for levels 1-6)");
      const tBullet = iconButton("bullets", "Bulleted list");
      const tCheck = iconButton("check", "Checklist (hold for task states)");
      const tQuote = iconButton("quote", "Quote (nest deeper with the indent button)");
      const tOutdent = iconButton("outdent", "Nest out: list or quote one level up");
      const tIndent = iconButton("indent", "Nest in: list or quote one level deeper");
      const tRule = iconButton("rule", "Horizontal rule");
      const tCode = iconButton("code", "Inline code");
      const tCodeBlock = iconButton("codeblock", "Code block");
      const tLink = iconButton("link", "Link\u2026");
      const tNoteLink = iconButton("note", "Link to another note\u2026");
      const tImage = iconButton("image", "Image");
      const tNumbered = iconButton("numbered", "Numbered list");
      const tTable = iconButton("table", "Table\u2026");
      const tInsert = iconButton("caret", "More: pictures, callouts, superscript, subscript, keyboard key (hold: callout kinds)", "zn-caret");
      const tSettings = iconButton("sliders", "Quick settings", "zn-mode-btn");
      const tSync = iconButton("link", "Linked scrolling", "zn-mode-btn zn-sync-btn");
      const tSplit = iconButton("columns", "Split view: editor and preview", "zn-mode-btn");
      const tMode = iconButton("eye", "Read (Ctrl+E)", "zn-mode-btn");
      const TOOL_TITLES = [
        [tBold, "Bold", "bold"], [tItalic, "Italic", "italic"], [tStrike, "Strikethrough", "strike"],
        [tHl, "Highlight selection", "highlight"], [tHeading, "Heading", "heading"], [tBullet, "Bulleted list", "bullet"],
        [tNumbered, "Numbered list", "numbered"], [tCheck, "Checklist", "check"], [tQuote, "Quote (nest deeper with the indent button)", "quote"],
        [tOutdent, "Nest out: list or quote one level up", "outdent"], [tIndent, "Nest in: list or quote one level deeper", "indent"],
        [tRule, "Horizontal rule", "rule"], [tCode, "Inline code", "code"], [tCodeBlock, "Code block", "codeBlock"],
        [tLink, "Link\u2026", "link"], [tNoteLink, "Link to another note\u2026", "noteLink"], [tImage, "Image", "image"], [tTable, "Table\u2026", "table"], [tSettings, "Quick settings", "settings"],
      ];
      const getPref = (k, d) => (env.getPref ? env.getPref(k, d) : d);
      const setPref = (k, v) => env.setPref?.(k, v);
      let shortcutCache = { raw: null, hid: null, list: [] };
      const hiddenTools = () => parseHidden(getPref(PREF.HIDDEN_TOOLS, ""));
      function shortcutList() {
        const raw = String(getPref(PREF.SHORTCUTS, "") || "");
        const hid = String(getPref(PREF.HIDDEN_TOOLS, "") || "");
        if (shortcutCache.raw !== raw || shortcutCache.hid !== hid) {
          const gone = parseHidden(hid);
          shortcutCache = { raw, hid, list: effectiveShortcuts(parseShortcutMap(raw)).filter((x) => !gone.has(x.id)) };
        }
        return shortcutCache.list;
      }
      const tools = h(
        "div",
        { class: "zn-tools" },
        tBold, tItalic, tStrike, tHl, tHlMenu, tHeading, tBullet, tNumbered, tCheck, tQuote, tOutdent, tIndent, tRule,
        tCode, tCodeBlock, tLink, tNoteLink, tImage, tTable, tInsert,
        h("span", { class: "zn-grow" }),
        tSettings,
        tSync,
        tSplit,
        tMode,
      );

      const ta = h("textarea", {
        class: "zn-editor",
        spellcheck: "true",
        placeholder: "Start writing\u2026 the first line is the title.",
        "aria-label": "Note text",
      });
      const readEl = h("div", { class: "zn-read", tabindex: "0" });
      const search = h("input", {
        type: "text",
        class: "zn-search",
        placeholder: "Search notes",
        "aria-label": "Search notes",
        spellcheck: "false",
      });
      const btnNew = iconButton("plus", "New note (Ctrl+N)", "zn-new");
      const btnFolder = iconButton("folder", "New folder", "zn-newfolder");
      const chipAll = h("button", { type: "button", class: "zn-chip" }, "Notes");
      const chipRecent = h("button", { type: "button", class: "zn-chip" }, "Recent");
      const chipTrash = h("button", { type: "button", class: "zn-chip" }, "Trash");
      const chipEmpty = h("button", { type: "button", class: "zn-chip zn-chip-danger" }, "Empty trash");
      const listItems = h("div", { class: "zn-items", role: "list" });
      const listEl = h(
        "div",
        { class: "zn-list" },
        h("div", { class: "zn-list-head" }, h("span", { class: "zn-search-wrap" }, icon("search", 13), search), btnFolder, btnNew),
        h("div", { class: "zn-chips" }, chipAll, chipRecent, chipTrash, h("span", { class: "zn-grow" }), chipEmpty),
        listItems,
      );
      // Find "highlight every match" layer (pref find_highlight = backdrop): sits under the transparent textarea.
      const hlInner = h("div", { class: "zn-findlayer-inner" });
      const hlEl = h("div", { class: "zn-findlayer", "aria-hidden": "true", hidden: true }, hlInner);
      const body = h("div", { class: "zn-body" }, hlEl, ta, readEl, listEl);
      const statusEl = h("span", { class: "zn-status", "aria-live": "polite" });
      const countEl = h("span", { class: "zn-count" });
      const foot = h("div", { class: "zn-foot" }, statusEl, h("span", { class: "zn-grow" }), countEl);
      const findInput = h("input", { type: "text", class: "zn-find-input", placeholder: "Find in notes", "aria-label": "Find in notes", spellcheck: "false" });
      const findCount = h("span", { class: "zn-find-count", "aria-live": "polite" });
      const btnFindPrev = iconButton("caret", "Previous match (Shift+Enter)", "zn-find-prev");
      const btnFindNext = iconButton("caret", "Next match (Enter)", "zn-find-next");
      const findOthers = h("button", { type: "button", class: "zn-find-others", title: "Open another note that contains this text" });
      const btnFindClose = iconButton("x", "Close find (Esc)", "zn-find-close");
      const findBar = h("div", { class: "zn-find", role: "search" }, icon("search", 13), findInput, findCount, btnFindPrev, btnFindNext, findOthers, btnFindClose);
      findBar.hidden = true;
      // "[[" completion: a short strip of matching notes under the toolbar while the caret is inside an open [[.
      const wikiBar = h("div", { class: "zn-wikibar", role: "listbox", "aria-label": "Notes to link" });
      wikiBar.hidden = true;
      // Optional strip under the read view: the notes that link here.
      const linkedEl = h("div", { class: "zn-linked" });
      linkedEl.hidden = true;
      // Debug sampling (pref debug_perf, off by default): these three are the hot paths named in the audit list.
      layout = PERF.wrap("notes.layout", layout);
      moveEvent = PERF.wrap("notes.drag-move", moveEvent);
      renderReadInner = PERF.wrap("notes.read-render", renderReadInner);
      const strip = h("div", { class: "zn-strip", role: "toolbar", "aria-label": "Pinned and recent notes", hidden: true });
      root.append(head, tools, strip, findBar, wikiBar, body, linkedEl, foot);
      // Eight resize grips (edges and corners); CSS shows them only where the sheet may be moved.
      for (const hd of RESIZE_HANDLES) root.append(h("span", { class: "zn-rz", "data-h": hd }));

      // ---- state -> DOM ----------------------------------------------------
      const note = () => store.get(currentId);
      // Split view as two windows: only where the sheet floats over a host and the option is on.
      function applyState() {
        const n = note();
        root.dataset.view = view;
        root.dataset.mode = mode;
        root.dataset.size = store.meta.size;
        labelEl.hidden = !n?.label || view === "list";
        labelEl.textContent = n?.label || "";
        paintReminderChip(n);
        paintFindState();
                root.dataset.color = n?.color || "none";
        root.dataset.trashed = n?.trashed ? "true" : "false";
        titleEl.textContent =
          view === "list" ? (filter === "trash" ? "Trash" : "All notes") : titleOf(n?.body || "") || "Untitled note";
        titleEl.title = view === "list" ? "Back to note" : "All notes";
        btnPin.classList.toggle("is-on", !!n?.pinned);
        btnPin.title = n?.pinned ? "Unpin note" : "Pin note to the top of the list";
        btnPin.setAttribute("aria-pressed", n?.pinned ? "true" : "false");
        colorDot.dataset.color = n?.color || "none";
        const big = store.meta.size !== "peek";
        btnSize.replaceChildren(icon(big ? "minimize" : "maximize"));
        btnSize.title = big ? "Smaller (hold: fill the whole area)" : "Larger (hold: fill the whole area)";
        root.dataset.geo = adapter.geoKey ? "on" : "off";
        root.dataset.slot = adapter.slotKind?.() || "";
        const panelHosted = !!adapter.pushPanel;
        btnHover.hidden = btnDock.hidden = !panelHosted;
        if (panelHosted) {
          const dm = dockMode();
          root.dataset.dock = dm;
          root.dataset.placement = adapter.placement?.() || "overlay";
          for (const [btn, on] of [[btnKeep, dm === "pin"], [btnHover, dm === "hover"], [btnDock, dm === "dock"]]) {
            btn.classList.toggle("is-on", on);
            btn.setAttribute("aria-pressed", on ? "true" : "false");
          }
          btnKeep.title = "Pin: stays open over the panel without moving it (hold: reset position)";
        } else {
          delete root.dataset.dock;
          delete root.dataset.placement;
          btnKeep.classList.toggle("is-on", store.meta.pinned !== false);
          btnKeep.setAttribute("aria-pressed", store.meta.pinned !== false ? "true" : "false");
          btnKeep.title = store.meta.pinned !== false ? "Kept open: click to close on an outside click (hold: reset position)" : "Closes on an outside click: click to keep open (hold: reset position)";
        }
        tSync.hidden = mode !== "split";
        tSync.classList.toggle("is-on", !!store.meta.syncScroll);
        tSync.setAttribute("aria-pressed", store.meta.syncScroll ? "true" : "false");
        tSync.title = store.meta.syncScroll ? "Linked scrolling: on (click to unlink)" : "Linked scrolling: off (click to link)";
        tSplit.classList.toggle("is-on", mode === "split");
        tSplit.setAttribute("aria-pressed", mode === "split" ? "true" : "false");
        tSplit.title = mode === "split" ? "Close split view" : "Split view: editor and preview";
        tMode.replaceChildren(icon(mode === "read" ? "edit" : "eye"));
        tMode.title = mode === "read" ? "Edit (Ctrl+E)" : "Read (Ctrl+E)";
        hlDot.dataset.color = store.meta.highlight;
        const gone = hiddenTools();
        for (const [btn, base, id] of TOOL_TITLES) {
          const combo = shortcutList().find((x) => x.id === id)?.combo;
          btn.title = combo ? `${base} (${combo})` : base;
          if (id !== "settings") btn.hidden = gone.has(id);
        }
        tHlMenu.hidden = gone.has("highlight");
        tInsert.hidden = false; // always holds the picture entries
        ta.readOnly = !!n?.trashed;
        ta.hidden = mode === "read";
        readEl.hidden = mode === "edit";
        chipAll.classList.toggle("is-on", filter === "all");
        chipRecent.classList.toggle("is-on", filter === "recent");
        chipTrash.classList.toggle("is-on", filter === "trash");
        chipTrash.textContent = store.trashCount() ? `Trash (${store.trashCount()})` : "Trash";
        chipEmpty.hidden = filter !== "trash" || !store.trashCount();
      }
      function updateChrome() {
        rafChrome = 0;
        const n = note();
        paintStrip();
        if (n) {
          titleEl.textContent =
            view === "list" ? titleEl.textContent : titleOf(n.body) || "Untitled note";
          const ext = getPref(PREF.FOOTER_COUNTER, false) === true;
          const sel = ext && mode !== "read" && ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : "";
          countEl.textContent = counterText(n.body, sel, ext);
          const spell = spellcheckOn(getPref(PREF.SPELL, true), getPref(PREF.SPELL_MAX, 100000), n.body.length);
          if (ta.spellcheck !== spell) ta.spellcheck = spell;
        } else countEl.textContent = "";
        const s = store.state;
        statusEl.dataset.state = s.save;
        statusEl.textContent =
          flashMsg ||
          { saved: "Saved", dirty: "Unsaved\u2026", saving: "Saving\u2026", error: "Couldn\u2019t save, retrying" }[s.save] ||
          "";
        statusEl.title = s.error || "";
      }
      const scheduleChrome = () => {
        if (!rafChrome) rafChrome = window.requestAnimationFrame(updateChrome);
      };
      // Draws only the blocks that changed since the last draw (see diffSigs). A note switch or a
      // changed read option starts from scratch.
      function resetRead() {
        readEl.replaceChildren();
        readSigs = [];
        readNodes = [];
        readAnch = [];
        readAnchY = null;
        readEmpty = false;
      }
      function buildReadAnchors(blocks) {
        readAnch = [];
        readAnchY = null;
        blocks.forEach((b, i) => {
          const nodes = readNodes[i] || [];
          if (b.type === "list") {
            let k = 0;
            for (const it of b.items) {
              if (nodes[k] && it.line >= 0) readAnch.push({ line: it.line, node: nodes[k] });
              k += 1 + (it.more ? it.more.length : 0);
            }
          } else if (nodes[0] && b.src !== undefined) readAnch.push({ line: b.src, node: nodes[0] });
        });
      }
      function renderRead() {
        renderReadInner();
        tagHeadings();
        paintLinked();
      }
      function renderReadInner() {
        const n = note();
        if (!n || !n.body.trim()) {
          resetRead();
          readEmpty = true;
          readEl.append(h("p", { class: "zn-empty" }, "Nothing here yet. Switch to edit and start writing."));
          return;
        }
        if (readEmpty) resetRead();
        const blocks = parseBlocks(readBody(n.body), false, env.readOpts?.() || {});
        const sigs = blocks.map(blockSig);
        const { prefix, suffix } = diffSigs(readSigs, sigs);
        if (prefix === readSigs.length && prefix === sigs.length) {
          buildReadAnchors(blocks);
          return;
        }
        const tail = readNodes.slice(readNodes.length - suffix);
        for (const nodes of readNodes.slice(prefix, readNodes.length - suffix)) for (const nd of nodes) nd.remove();
        const anchor = tail.find((nodes) => nodes.length)?.[0] || null;
        const fresh = [];
        for (let i = prefix; i < blocks.length - suffix; i++) {
          const tmp = h("div");
          renderBlocks(tmp, [blocks[i]], env, (line) => setBody(toggleCheckboxLine(note().body, line)));
          const nodes = [...tmp.childNodes];
          for (const nd of nodes) readEl.insertBefore(nd, anchor);
          fresh.push(nodes);
        }
        readNodes = [...readNodes.slice(0, prefix), ...fresh, ...tail];
        readSigs = sigs;
        buildReadAnchors(blocks);
      }
      function schedulePreview() {
        window.clearTimeout(previewTimer);
        previewTimer = window.setTimeout(() => {
          previewTimer = 0;
          if (isOpen && !destroyed && view === "editor" && mode !== "edit") renderRead();
        }, PREVIEW_IDLE_MS);
      }
      function flash(message, ms = 4000) {
        flashMsg = message;
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => {
          flashTimer = 0;
          flashMsg = "";
          scheduleChrome();
        }, ms);
        scheduleChrome();
      }
      function setBody(text) {
        store.update(currentId, text, null);
        const st = ta.scrollTop;
        ta.value = text;
        ta.scrollTop = st;
        typed = false;
        if (mode !== "edit") renderRead();
        scheduleChrome();
      }
      function showNote(id) {
        currentId = id;
        const n = note();
        ta.value = n ? n.body : "";
        typed = false;
        window.clearTimeout(previewTimer);
        resetRead();
        if (mode !== "edit") renderRead();
        applyState();
        updateChrome();
        if (findOpen) refreshFind({ jump: true, keep: false });
      }
      // Set when the user pressed ANYWHERE outside this sheet (a text field in a web panel, the panel URL bar, the
      // page). Automatic focus (an open that finished after an async load, a reopen after a panel rebuild, a mode
      // change) must never take the caret back from there. Cleared by a press inside the sheet or an explicit open.
      let outsideClaim = false;
      function focusEditor() {
        if (view !== "editor" || outsideClaim) return;
        const target = mode === "read" ? readEl : ta;
        try {
          target.focus({ preventScroll: true });
          if (mode !== "read") ta.setSelectionRange(ta.value.length, ta.value.length);
        } catch (_) {}
      }
      function openNote(id, { focus = true } = {}) {
        if (currentId && currentId !== id) store.discardIfEmpty(currentId);
        store.setMeta({ lastNoteId: id, recent: pushRecent(store.meta.recent, id) });
        view = "editor";
        const n = store.get(id);
        mode = n?.trashed ? "read" : store.meta.mode;
        showNote(id);
        if (focus) focusEditor();
      }
      // Link support for the read pane: the sheet adds what it alone knows (the open store) to env.
      const noteInfo = (id) => {
        const t = store.get(id);
        return t ? { title: titleOf(t.body) || "Untitled note", trashed: !!t.trashed, desc: hubDescription(t) } : null;
      };
      // Delegates to the caller's env (live: later changes to it stay visible) and only adds the two lookups.
      env = Object.assign(Object.create(env), {
        noteInfo,
        hubDescriptions: () => getPref(PREF.HUB_DESC, true) !== false,
        taskCycle: (line) => { if (!note()?.trashed) setBody(cycleTaskStatus(note().body, line)); },
        tableToggle: (line, col, k) => { if (!note()?.trashed) setBody(toggleTableBox(note().body, line, col, k)); },
        taskMenu: (line, anchor) => {
          if (note()?.trashed) return;
          showMenu(anchor, TASK_STATUSES.map(([ch, name]) => ({ icon: "check", label: "[" + ch + "]  " + name, action: () => setBody(setLineTaskStatus(note().body, line, ch)) })));
        },
        jumpFootnote: (label, back, from) => jumpFootnote(label, back, from),
        openNoteLink: (id, heading = "") => {
          if (!store.get(id)) return flash("That note no longer exists");
          if (id !== currentId) openNote(id, { focus: false });
          if (heading) goHeading(heading);
        },
      });
      // Heading anchors: the read view tags its top-level headings with the same unique slugs headingsOf gives.
      function tagHeadings() {
        const seen = new Map();
        for (const nd of readEl.childNodes) {
          if (!/^H[1-6]$/i.test(nd.tagName || nd.nodeName || "")) continue;
          const base = headingSlug(nd.textContent);
          const k = seen.get(base) || 0;
          seen.set(base, k + 1);
          nd.dataset.slug = k ? base + "-" + k : base;
        }
      }
      function goHeading(slug) {
        if (mode !== "edit") {
          renderRead();
          const el = [...readEl.childNodes].find((nd) => nd.dataset?.slug === slug);
          if (el) {
            const y = el.offsetTop || 0;
            readEl.scrollTop = Math.max(0, y - 8);
            el.scrollIntoView?.({ block: "start" });
          }
        }
        if (mode !== "read") {
          const off = headingOffset(ta.value, slug);
          if (off >= 0) revealSourceMatch({ start: off, end: off });
        }
      }
      function jumpFootnote(label, back, from) {
        const sel = back ? '[data-fnref="' + label + '"]' : '[data-fn="' + label + '"]';
        const el = readEl.querySelector?.(sel);
        if (!el) return;
        el.scrollIntoView?.({ block: "center" });
        el.focus?.({ preventScroll: true });
      }
      const readBody = (body) => expandWikiLinks(body, (t) => resolveNoteTitle(store.list().concat(store.list({ trashed: true })), t));
      function newNote(folderId) {
        const folder = typeof folderId === "string" ? cleanFolder(folderId) : "";
        if (folder && store.meta.folders.find((f) => f.id === folder)?.collapsed) store.setFolderCollapsed(folder, false);
        const n = store.create("", folder);
        mode = "edit";
        store.setMeta({ mode: "edit" });
        openNote(n.id);
      }
      function setMode(next) {
        if (mode === next) return;
        mode = next;
        if (!note()?.trashed) store.setMeta({ mode });
        if (mode !== "edit") renderRead();
        applyState();
        scheduleLayout();
        if (findOpen) refreshFind({ jump: true, keep: false });
        else focusEditor();
      }
      function showList() {
        view = "list";
        applyState();
        renderList();
        window.requestAnimationFrame(() => {
          if (outsideClaim) return;
          try {
            search.focus({ preventScroll: true });
            search.select();
          } catch (_) {}
        });
      }
      function showEditor() {
        if (!currentId || !store.get(currentId)) {
          const id = store.latestId();
          if (id) openNote(id);
          else newNote();
          return;
        }
        view = "editor";
        applyState();
        focusEditor();
      }

      // ---- find in notes (P2) ----------------------------------------------------------------
      // Edit and split view search the note's source text (the editor selects and scrolls to the match; with linked
      // scrolling the preview follows, otherwise it is scrolled to the same block). Read view searches the drawn text
      // and selects the match there. "found in N other notes" lists the other non-trashed notes with the phrase.
      const findQuery = () => normalizeFindQuery(findInput.value);
      const textOfNode = (nd) => (typeof nd.nodeValue === "string" ? nd.nodeValue : nd._text || "");
      function readTextNodes() {
        const out = [];
        const walk = (el) => {
          for (const k of el.childNodes ? [...el.childNodes] : el.children || []) {
            if (k.nodeType === 3 || k.tag === "#text") out.push(k);
            else walk(k);
          }
        };
        walk(readEl);
        return out;
      }
      function computeFind() {
        const q = findQuery();
        findList = [];
        findRuns = null;
        if (!q || view !== "editor" || !note()) return;
        if (mode === "read") {
          findRuns = readTextNodes();
          findList = findInRuns(findRuns.map(textOfNode), q);
        } else findList = findMatches(ta.value, q);
      }
      // ---- find highlight (pref find_highlight = backdrop) ----
      const hlOn = () => findOpen && findList.length > 0 && getPref(PREF.FIND_HL, "selection") === "backdrop";
      function clearHighlights() {
        hlEl.hidden = true;
        hlInner.replaceChildren();
        delete root.dataset.hl;
        try { window.CSS?.highlights?.delete("zn-find"); window.CSS?.highlights?.delete("zn-find-cur"); } catch (_) {}
      }
      function syncBackdropScroll() {
        if (hlEl.hidden) return;
        hlInner.style.transform = `translate(${-(ta.scrollLeft || 0)}px, ${-(ta.scrollTop || 0)}px)`;
      }
      function paintBackdrop() {
        if (!hlOn()) return clearHighlights();
        try {
          if (findRuns) {
            // Read view: the CSS Custom Highlight API paints ranges without touching the text.
            const H = window.Highlight, reg = window.CSS?.highlights;
            if (typeof H !== "function" || !reg) return clearHighlights();
            const ranges = findList.slice(0, FIND_MAX_MATCHES).map((m, i) => {
              const r = document.createRange();
              r.setStart(findRuns[m.run], m.start);
              r.setEnd(findRuns[m.run], m.end);
              return [i, r];
            });
            reg.set("zn-find", new H(...ranges.filter(([i]) => i !== findIdx).map(([, r]) => r)));
            const cur = ranges.find(([i]) => i === findIdx);
            if (cur) reg.set("zn-find-cur", new H(cur[1]));
            else reg.delete("zn-find-cur");
            hlEl.hidden = true;
            return;
          }
          if (mode === "read") return clearHighlights();
          const gcs = window.getComputedStyle;
          if (typeof gcs === "function") {
            const cs = gcs(ta);
            for (const k of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "whiteSpace", "overflowWrap", "wordBreak"]) hlEl.style[k] = cs[k];
          }
          Object.assign(hlEl.style, { left: (ta.offsetLeft || 0) + "px", top: (ta.offsetTop || 0) + "px", width: (ta.clientWidth || 0) + "px", height: (ta.clientHeight || 0) + "px" });
          const nodes = [];
          for (const seg of highlightSegments(ta.value, findList)) {
            if (seg.hit === false) nodes.push(document.createTextNode(seg.text));
            else nodes.push(h("mark", { class: seg.hit === findIdx ? "zn-findlayer-cur" : "" }, seg.text));
          }
          nodes.push(document.createTextNode("\n")); // a trailing newline keeps the last empty line as tall as the textarea's
          hlInner.replaceChildren(...nodes);
          hlEl.hidden = false;
          root.dataset.hl = "on";
          syncBackdropScroll();
        } catch (error) {
          console.warn("[ZentralNotes] find highlight failed", error);
          clearHighlights();
        }
      }
      function paintFindState() {
        findBar.hidden = !(findOpen && view === "editor");
        if (findBar.hidden) return clearHighlights();
        paintBackdrop();
        const q = findQuery();
        findCount.textContent = !q ? "" : findList.length ? `${findIdx >= 0 ? findIdx + 1 : "\u2013"} of ${findList.length}${findList.length >= FIND_MAX_MATCHES ? "+" : ""}` : "No matches";
        const n = findOtherIds.length;
        findOthers.hidden = !q;
        findOthers.textContent = n ? `found in ${n} other ${n === 1 ? "note" : "notes"}` : "not found in other notes";
        findOthers.disabled = !n;
        btnFindPrev.disabled = btnFindNext.disabled = !findList.length;
      }
      function measureCaretY(offset) {
        if (!measureEditor()) return null;
        const marker = h("span", {}, "\u200b");
        mirror.replaceChildren(document.createTextNode(ta.value.slice(0, offset)), marker);
        const y = marker.offsetTop;
        mirror.replaceChildren();
        return y;
      }
      function revealInPreview(m) {
        if (!readAnch.length) return;
        readAnchY = readAnchY || measureRead();
        const y = mapPosition(readAnchY, lineOfOffset(ta.value, m.start), "line", "y");
        const next = revealScroll({ y, top: readEl.scrollTop, height: readEl.clientHeight });
        if (next !== null) readEl.scrollTop = next;
      }
      function revealSourceMatch(m) {
        findAnchor = m.start;
        ta.setSelectionRange(m.start, m.end);
        let y = null;
        try { y = measureCaretY(m.start); } catch (_) {}
        if (y === null) y = (lineOfOffset(ta.value, m.start) / Math.max(1, ta.value.split("\n").length)) * (ta.scrollHeight || 0);
        let lh = 18;
        try { lh = parseFloat(window.getComputedStyle(ta).lineHeight) || 18; } catch (_) {}
        const next = revealScroll({ y, h: lh, top: ta.scrollTop, height: ta.clientHeight });
        if (next !== null) ta.scrollTop = next; // linked scrolling carries the preview along
        if (mode === "split" && !store.meta.syncScroll) revealInPreview(m);
      }
      function revealRunMatch(m) {
        const nd = findRuns[m.run];
        const range = document.createRange();
        range.setStart(nd, m.start);
        range.setEnd(nd, m.end);
        const rect = range.getBoundingClientRect();
        const y = rect.top - readEl.getBoundingClientRect().top + readEl.scrollTop;
        const next = revealScroll({ y, h: rect.height, top: readEl.scrollTop, height: readEl.clientHeight });
        if (next !== null) readEl.scrollTop = next;
        const picked = window.getSelection?.();
        if (picked) {
          picked.removeAllRanges();
          picked.addRange(range);
        }
      }
      function showFindMatch() {
        const m = findList[findIdx];
        if (!m) return;
        try {
          if (findRuns) revealRunMatch(m);
          else revealSourceMatch(m);
        } catch (error) {
          console.warn("[ZentralNotes] find reveal failed", error);
        }
      }
      function refreshFind({ jump = false, keep = true } = {}) {
        if (!findOpen || destroyed) return;
        const prev = keep && findIdx >= 0 ? findList[findIdx] : null;
        computeFind();
        findOtherIds = findQuery() ? searchOtherNotes(store.list({ trashed: false }), findQuery(), currentId).ids : [];
        if (!findList.length) findIdx = -1;
        else if (jump) findIdx = findRuns ? 0 : firstMatchFrom(findList, findAnchor);
        else if (prev && !findRuns) findIdx = Math.max(0, findList.findIndex((m) => m.start >= prev.start));
        else findIdx = Math.min(Math.max(findIdx, -1), findList.length - 1);
        if (jump) showFindMatch();
        paintFindState();
      }
      function scheduleFindRefresh() {
        if (!findOpen) return;
        window.clearTimeout(findTimer);
        findTimer = window.setTimeout(() => {
          findTimer = 0;
          refreshFind();
        }, 120);
      }
      function goFind(dir) {
        if (!findList.length) return;
        findIdx = stepMatchIndex(findIdx, findList.length, dir);
        showFindMatch();
        paintFindState();
      }
      function openFind() {
        if (view === "list") {
          try { search.focus({ preventScroll: true }); search.select(); } catch (_) {}
          return;
        }
        if (!note()) return;
        findOpen = true;
        if (mode !== "read") {
          const [s0, e0] = sel();
          findAnchor = s0;
          const picked = ta.value.slice(s0, e0);
          if (picked && !/[\r\n]/.test(picked) && picked.length <= FIND_MAX_QUERY) findInput.value = picked;
        } else findAnchor = 0;
        outsideClaim = false;
        refreshFind({ jump: true, keep: false });
        try { findInput.focus({ preventScroll: true }); findInput.select(); } catch (_) {}
      }
      function closeFind() {
        if (!findOpen) return;
        findOpen = false;
        window.clearTimeout(findTimer);
        findTimer = 0;
        findList = [];
        findRuns = null;
        findIdx = -1;
        try { if (mode === "read") window.getSelection?.()?.removeAllRanges(); } catch (_) {}
        paintFindState();
        focusEditor();
      }
      function openFoundNote(id) {
        const phrase = findInput.value;
        openNote(id, { focus: false });
        findOpen = true;
        findInput.value = phrase;
        findAnchor = 0;
        refreshFind({ jump: true, keep: false });
        try { findInput.focus({ preventScroll: true }); } catch (_) {}
      }
      listen(findInput, "input", () => {
        window.clearTimeout(findTimer);
        findTimer = window.setTimeout(() => {
          findTimer = 0;
          refreshFind({ jump: true, keep: false });
        }, 120);
      });
      listen(findInput, "keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
        if (findTimer) {
          window.clearTimeout(findTimer);
          findTimer = 0;
          refreshFind({ jump: true, keep: false });
          return;
        }
        goFind(e.shiftKey ? -1 : 1);
      });
      listen(btnFindNext, "click", () => goFind(1));
      listen(btnFindPrev, "click", () => goFind(-1));
      listen(btnFindClose, "click", () => closeFind());
      listen(findOthers, "click", () => {
        const items = findOtherIds.slice(0, 12).map((id) => {
          const n = store.get(id);
          return n && { icon: "note", label: titleOf(n.body) || n.label || "Untitled note", action: () => openFoundNote(id) };
        }).filter(Boolean);
        if (findOtherIds.length > 12) items.push({ label: `\u2026and ${findOtherIds.length - 12} more (narrow the search)`, action: () => {} });
        if (items.length) showMenu(findOthers, items);
      });

      // ---- pasted pictures (P2) ----------------------------------------------------------------
      const PICTURE_ERRORS = {
        type: "Only PNG, JPEG, GIF and WebP pictures can be pasted.",
        mismatch: "That picture's type does not match its contents, so it was not pasted.",
        "too-big": "That picture is bigger than 5 MB.",
        "too-many": "This note already holds 200 pictures.",
        "note-name": "This note's file name cannot hold pictures. Duplicate the note and paste there.",
        io: "Couldn't save the picture here.",
        empty: "Nothing to paste.",
        note: "Open a note first.",
        name: "Couldn't pick a free picture name.",
      };
      // The first supported picture file on the clipboard, only when the clipboard holds no text to paste instead.
      function clipboardPicture(data) {
        if (!data) return null;
        try { if ((data.getData?.("text/plain") || "").trim()) return null; } catch (_) {}
        const files = [];
        for (const it of data.items ? [...data.items] : []) if (it.kind === "file" && /^image\//i.test(it.type || "")) { const f = it.getAsFile?.(); if (f) files.push(f); }
        if (!files.length) for (const f of data.files ? [...data.files] : []) if (/^image\//i.test(f.type || "")) files.push(f);
        return files.find((f) => ASSET_MIME[f.type]) || files[0] || null;
      }
      async function insertPicture(bytes, claimed, at) {
        const n = note();
        if (!n || n.trashed) return flash(PICTURE_ERRORS.note);
        const id = n.id, before = ta.value;
        const res = await store.saveAsset(id, bytes, ASSET_MIME[claimed] ? claimed : "");
        if (destroyed) return;
        if (!res.ok) return flash(PICTURE_ERRORS[res.reason] || PICTURE_ERRORS.io);
        if (currentId !== id || note()?.trashed) return flash("Picture saved with the note it was pasted into.");
        const [s0, e0] = ta.value === before ? at : [ta.selectionStart, ta.selectionEnd];
        if (mode === "read") setMode("edit");
        applyEdit(insertAssetImage(ta.value, s0, e0, "image", res.rel));
        flash("Picture added");
      }
      async function pastePictureFile(file) {
        if (!file) return;
        if (file.size > ASSET_MAX_BYTES) return flash(PICTURE_ERRORS["too-big"]);
        let bytes;
        try { bytes = new Uint8Array(await file.arrayBuffer()); } catch (_) { return flash("Couldn't read the picture from the clipboard."); }
        return insertPicture(bytes, file.type, sel());
      }
      async function pastePictureFromClipboard() {
        if (note()?.trashed) return;
        const at = sel();
        try {
          const items = await window.navigator.clipboard.read();
          for (const item of items) {
            const type = item.types.find((t) => ASSET_MIME[t]);
            if (!type) continue;
            const blob = await item.getType(type);
            if (blob.size > ASSET_MAX_BYTES) return flash(PICTURE_ERRORS["too-big"]);
            return insertPicture(new Uint8Array(await blob.arrayBuffer()), type, at);
          }
          flash("No supported picture on the clipboard.");
        } catch (_) {
          flash("The clipboard can't be read here. Click the note and press Ctrl+V instead.");
        }
      }
      function askPictureOptions() {
        if (note()?.trashed) return;
        if (mode === "read") setMode("edit");
        const caret = ta.selectionStart;
        const hit = assetImageAt(ta.value, caret);
        if (!hit) return flash("Put the caret inside a pasted picture's link first.");
        let align = hit.link.align;
        const aligns = [["", "None"], ["left", "Left"], ["center", "Centre"], ["right", "Right"]].map(([v, label]) => {
          const b = chip(label, v === align);
          b.addEventListener("click", () => { align = v; for (const [o, x] of aligns) o.classList.toggle("is-on", x === v); });
          return [b, v];
        });
        const w = field("Width in pixels (empty = original size)", hit.link.width ? String(hit.link.width) : "", "original");
        const presets = [["Small", 200], ["Medium", 400], ["Large", 640], ["Original", 0]].map(([label, px]) => {
          const b = chip(label);
          b.addEventListener("click", () => { w.input.value = px ? String(px) : ""; });
          return b;
        });
        const ok = chip("Apply", true), cancel = chip("Cancel");
        openCard("Picture options", h("div", { class: "zn-dialog-actions" }, ...aligns.map(([b]) => b)), w.row, h("div", { class: "zn-dialog-actions" }, ...presets), h("div", { class: "zn-dialog-actions" }, cancel, ok));
        const submit = () => {
          const raw = w.input.value.trim();
          const px = raw ? Number(raw) : 0;
          if (raw && !(px >= ASSET_W_MIN && px <= ASSET_W_MAX)) { w.input.dataset.bad = "true"; w.input.focus(); return; }
          closeDialog();
          const edit = restyleAssetImage(ta.value, caret, { width: px, align });
          if (edit) applyEdit(edit);
        };
        ok.addEventListener("click", submit);
        cancel.addEventListener("click", () => { closeDialog(); focusEditor(); });
        w.input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); submit(); } });
      }

      // ---- reminders (P2) ----------------------------------------------------------------------
      const nowMs = () => (env.now ? env.now() : Date.now());
      function reminderText(t) {
        return remindDateText(t) + " " + remindTimeText(t);
      }
      function paintReminderChip(n) {
        const on = !!n && !n.trashed && n.remind > 0 && view === "editor";
        remindEl.hidden = !on;
        if (!on) return;
        remindEl.replaceChildren(icon("bell", 12), h("span", {}, reminderText(n.remind).slice(5)));
        const passed = n.remind <= nowMs();
        remindEl.classList.toggle("is-due", passed);
        remindEl.title = (passed ? "Reminder time passed: " : "Reminder: ") + reminderText(n.remind) + " (click to change)";
      }
      function askReminder() {
        const n = note();
        if (!n || n.trashed) return;
        const now = nowMs();
        const presets = reminderPresets(now);
        const start = n.remind > now ? n.remind : presets[0][1];
        const d = field("Date (YYYY-MM-DD)", remindDateText(start), "2026-11-02");
        const t = field("Time (HH:MM)", remindTimeText(start), "09:00");
        const preview = h("div", { class: "zn-remind-preview", "aria-live": "polite" });
        const paintPreview = () => {
          const at = parseRemindInput(d.input.value, t.input.value);
          preview.textContent = remindPreview(at, nowMs());
          preview.dataset.bad = at && at > nowMs() ? "false" : "true";
        };
        const quick = presets.map(([label, at]) => {
          const b = chip(label);
          b.addEventListener("click", () => { d.input.value = remindDateText(at); t.input.value = remindTimeText(at); paintPreview(); });
          return b;
        });
        for (const f of [d, t]) f.input.addEventListener("input", paintPreview);
        paintPreview();
        const ok = chip("Set reminder", true), cancel = chip("Cancel");
        const buttons = [cancel];
        if (n.remind) {
          const clear = chip("Clear reminder");
          clear.addEventListener("click", () => { closeDialog(); store.setReminder(n.id, 0); applyState(); flash("Reminder cleared"); });
          buttons.push(clear);
        }
        buttons.push(ok);
        openCard("Remind me about this note", h("div", { class: "zn-dialog-actions" }, ...quick), d.row, t.row, preview, h("div", { class: "zn-dialog-actions" }, ...buttons));
        const submit = () => {
          const at = parseRemindInput(d.input.value, t.input.value);
          if (!at || at <= nowMs()) {
            (at ? t : d).input.dataset.bad = "true";
            (at ? t : d).input.focus();
            return;
          }
          closeDialog();
          store.setReminder(n.id, at);
          applyState();
          flash("Reminder set for " + reminderText(at));
          focusEditor();
        };
        ok.addEventListener("click", submit);
        cancel.addEventListener("click", () => { closeDialog(); focusEditor(); });
        for (const f of [d, t]) f.input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); submit(); } });
      }
      listen(remindEl, "click", () => askReminder());

      // ---- list view -----------------------------------------------------------
      // The last opened notes, newest first, narrowed by the search box.
      function recentNotes() {
        const q = query.trim().toLowerCase();
        return (store.meta.recent || [])
          .map((id) => store.get(id))
          .filter((n) => n && !n.trashed && (!q || n.body.toLowerCase().includes(q) || (n.label || "").toLowerCase().includes(q)));
      }
      // One note row. `opts.tree` = drawn inside the folder tree (indented, draggable onto folders).
      function buildItem(n, trashed, opts = {}) {
      const item = h("div", { class: "zn-item", role: opts.tree ? "treeitem" : "listitem", tabindex: "0", "data-id": n.id, "data-key": (opts.pinnedRow ? "p:" : "n:") + n.id });
      if (opts.tree) {
        item.style.setProperty("--d", String(opts.depth || 0));
        item.setAttribute("aria-level", String((opts.depth || 0) + 1));
        item.setAttribute("draggable", "true");
        item.addEventListener("dragstart", (e) => {
          dragNoteId = n.id;
          try {
            e.dataTransfer?.setData("text/plain", n.id);
          } catch (_) {}
        });
        item.addEventListener("dragend", () => (dragNoteId = ""));
      }
      item.dataset.color = n.color;
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMenu(pointAnchor(e), noteMenuItems(n));
      });
      if (n.id === currentId) item.classList.add("is-current");
      const act = h("span", { class: "zn-item-actions" });
      if (trashed) {
        const r = iconButton("restore", "Restore");
        r.addEventListener("click", (e) => {
          e.stopPropagation();
          store.restore(n.id);
          scheduleList();
        });
        const d = iconButton("trash", "Delete forever", "zn-danger");
        d.addEventListener("click", (e) => {
          e.stopPropagation();
          if (d.dataset.armed) {
            store.deleteForever(n.id).then(scheduleList);
          } else {
            d.dataset.armed = "true";
            d.title = "Click again to delete forever";
            window.clearTimeout(confirmTimer);
            confirmTimer = window.setTimeout(() => {
              delete d.dataset.armed;
              d.title = "Delete forever";
            }, 3000);
          }
        });
        act.append(r, d);
      } else {
        const p = iconButton("pin", n.pinned ? "Unpin" : "Pin", n.pinned ? "is-on" : "");
        p.addEventListener("click", (e) => {
          e.stopPropagation();
          store.setPinned(n.id, !n.pinned);
          scheduleList();
        });
        const t = iconButton("trash", "Move to trash");
        t.addEventListener("click", (e) => {
          e.stopPropagation();
          store.trash(n.id);
          if (n.id === currentId) currentId = "";
          scheduleList();
        });
        act.append(p, t);
      }
      item.append(
        h("span", { class: "zn-item-bar" }),
        h(
          "span",
          { class: "zn-item-main" },
          h("span", { class: "zn-item-title" }, (n.pinned ? "\u{1F4CC} " : "") + (titleOf(n.body) || "Untitled note")),
          ...(n.label ? [h("span", { class: "zn-item-label" }, n.label)] : []),
          ...(!opts.tree && cleanFolder(n.folder) ? [h("span", { class: "zn-item-label zn-item-folder" }, cleanFolder(n.folder))] : []),
          h("span", { class: "zn-item-snippet" }, snippetOf(n.body)),
        ),
        h("span", { class: "zn-item-time" }, relativeTime(trashed ? n.trashed : n.updated)),
        act,
      );
      const open = () => {
        openNote(n.id);
      };
      item.addEventListener("click", open);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          open();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          (item.nextElementSibling || item).focus?.();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (item.previousElementSibling) item.previousElementSibling.focus();
          else search.focus();
        } else if (e.key === "ArrowLeft" && opts.tree) {
          const fid = cleanFolder(n.folder);
          const up = !opts.pinnedRow && fid ? [...listItems.children].find((c) => c.dataset?.fid === fid) : null;
          if (up) {
            e.preventDefault();
            up.focus?.();
          }
        }
      });
        return item;
      }
      // ---- folder tree (D2) ----------------------------------------------------------------------
      let dragNoteId = "";
      const treeMode = () => filter === "all" && !query.trim();
      const folderTargets = (exclude = "") =>
        allFolderIds([...store.tree().notes, ...store.list()], store.meta.folders)
          .filter((id) => !exclude || !(id === exclude || id.startsWith(exclude + "/")))
          .sort();
      function buildFolderRow(node, depth, count) {
        const open = !node.collapsed;
        const chev = iconButton("caret", open ? "Collapse" : "Expand", "zn-chev");
        const add = iconButton("plus", "New note here", "zn-fadd");
        const more = iconButton("more", "Folder menu", "zn-fmore");
        const row = h(
          "div",
          { class: "zn-item zn-frow", role: "treeitem", tabindex: "0", "data-fid": node.id, "data-key": "f:" + node.id, "aria-level": String(depth + 1), "aria-expanded": open ? "true" : "false" },
          chev,
          h("span", { class: "zn-frow-icon" }, icon("folder", 14)),
          h("span", { class: "zn-item-main" }, h("span", { class: "zn-item-title" }, node.label)),
          h("span", { class: "zn-item-time" }, String(count)),
          h("span", { class: "zn-item-actions" }, add, more),
        );
        row.style.setProperty("--d", String(depth));
        const toggle = () => store.setFolderCollapsed(node.id, open);
        chev.addEventListener("click", (e) => {
          e.stopPropagation();
          toggle();
        });
        add.addEventListener("click", (e) => {
          e.stopPropagation();
          newNote(node.id);
        });
        more.addEventListener("click", (e) => {
          e.stopPropagation();
          showMenu(more, folderMenuItems(node));
        });
        row.addEventListener("click", toggle);
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showMenu(pointAnchor(e), folderMenuItems(node));
        });
        row.addEventListener("keydown", (e) => {
          if (e.target !== row) return;
          if (e.key === "Enter") {
            e.preventDefault();
            toggle();
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            if (!open) toggle();
            else row.nextElementSibling?.focus?.();
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (open) toggle();
            else {
              const parent = parentOfFolder(node.id);
              (parent ? [...listItems.children].find((c) => c.dataset?.fid === parent) : null)?.focus?.();
            }
          } else if (e.key === "F2") {
            e.preventDefault();
            askFolderName("Rename folder", node.label, (name) => store.renameFolder(node.id, name));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            (row.nextElementSibling || row).focus?.();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (row.previousElementSibling) row.previousElementSibling.focus();
            else search.focus();
          }
        });
        row.addEventListener("dragover", (e) => {
          if (!dragNoteId) return;
          e.preventDefault();
          row.classList.add("is-drop");
        });
        row.addEventListener("dragleave", () => row.classList.remove("is-drop"));
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove("is-drop");
          let id = dragNoteId;
          try {
            id = id || e.dataTransfer?.getData("text/plain") || "";
          } catch (_) {}
          dragNoteId = "";
          if (id && store.get(id) && store.setFolder(id, node.id)) scheduleList();
        });
        return row;
      }
      function folderMenuItems(node) {
        const items = [{ icon: "plus", label: "New note here", action: () => newNote(node.id) }, { icon: "plus", label: "Quick capture to today\u2019s note\u2026", action: () => queueMicrotask(() => askQuickCapture("")) }];
        if (folderDepth(node.id) < FOLDER_MAX_DEPTH)
          items.push({ icon: "folder", label: "New subfolder\u2026", action: () => askFolderName("New subfolder", "", (name) => store.addFolder(name, node.id)) });
        items.push(
          { icon: "edit", label: "Rename\u2026", action: () => askFolderName("Rename folder", node.label, (name) => store.renameFolder(node.id, name)) },
          { icon: "folder", label: "Move to\u2026", action: () => askFolderMove(node) },
          ...(node.id !== TABBAR_FOLDER && !node.id.startsWith(TABBAR_FOLDER + "/")
            ? [{ icon: "folder", label: "Move to Notes (tabbar)", action: () => { store.ensureTabbarFolder(); const r = store.moveFolder(node.id, TABBAR_FOLDER); flash(r ? "Shown in the Zen sidebar folder" : "Cannot move it there (too deep or name taken)"); scheduleList(); } }]
            : node.id !== TABBAR_FOLDER && parentOfFolder(node.id) === TABBAR_FOLDER
              ? [{ icon: "folder", label: "Remove from Notes (tabbar)", action: () => { const r = store.moveFolder(node.id, ""); flash(r ? "Moved out of the Zen sidebar folder" : "Cannot move it out"); scheduleList(); } }]
              : []),
          { sep: true },
          { icon: "trash", label: "Delete\u2026", danger: true, action: () => askFolderDelete(node) },
        );
        return items;
      }
      function renderTree(keep) {
        const root0 = store.tree();
        const pinned = store.list().filter((n) => n.pinned);
        const rows = treeRows(root0, pinned, getPref(PREF.TREE_ORDER, "folders-first"));
        if (!rows.length) {
          listItems.append(h("p", { class: "zn-empty" }, "No notes yet. Press + to create one."));
          return;
        }
        let shown = 0;
        for (const r of rows) {
          if (shown >= MAX_LIST_ROWS) break;
          shown++;
          if (r.type === "pinned") {
            listItems.append(h("div", { class: "zn-tree-head", role: "presentation" }, icon("pin", 12), h("span", {}, "Pinned"), h("span", { class: "zn-item-time" }, String(r.count))));
          } else if (r.type === "folder") listItems.append(buildFolderRow(r.node, r.depth, r.count));
          else listItems.append(buildItem(r.note, false, { tree: true, depth: r.depth, pinnedRow: !!r.pinnedRow }));
        }
        if (rows.length > MAX_LIST_ROWS)
          listItems.append(h("p", { class: "zn-empty" }, `Showing the first ${MAX_LIST_ROWS} of ${rows.length}. Use search to narrow down.`));
      }
      // Small dialogs for folder actions (one text field, a confirm, a target picker).
      function askFolderName(title, initial, onOk) {
        const f = field("Folder name", initial, "e.g. Work");
        f.input.maxLength = FOLDER_LABEL_MAX;
        const ok = chip("Save", true);
        const cancel = chip("Cancel");
        openCard(title, f.row, h("div", { class: "zn-dialog-actions" }, cancel, ok));
        const submit = () => {
          const name = f.input.value.trim();
          if (!name) {
            f.input.dataset.bad = "true";
            f.input.focus?.();
            return;
          }
          closeDialog();
          onOk(name);
        };
        ok.addEventListener("click", submit);
        cancel.addEventListener("click", closeDialog);
        f.input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        });
        f.input.focus?.({ preventScroll: true });
        f.input.select?.();
      }
      function askFolderDelete(node) {
        const toRoot = chip("Notes to top level", true);
        const toTrash = chip("Notes to trash");
        const cancel = chip("Cancel");
        openCard("Delete folder", h("p", {}, `Delete \u201c${node.label}\u201d and its subfolders? Notes inside are not lost unless you choose the trash.`), h("div", { class: "zn-dialog-actions" }, cancel, toTrash, toRoot));
        cancel.addEventListener("click", closeDialog);
        toRoot.addEventListener("click", () => {
          closeDialog();
          store.removeFolder(node.id, "toRoot");
        });
        toTrash.addEventListener("click", () => {
          closeDialog();
          store.removeFolder(node.id, "toTrash");
        });
        cancel.focus?.({ preventScroll: true });
      }
      // A list of folders to pick from ("Top level" first). `label(id)` indents by depth.
      function askFolderPick(title, targets, onPick, current = "") {
        const list = h("div", { class: "zn-aligns" });
        const cancel = chip("Cancel");
        const rowFor = (id) => {
          const b = chip(id ? "\u2003".repeat(folderDepth(id) - 1) + (store.meta.folders.find((f) => f.id === id)?.label || lastSeg(id)) : "Top level", id === current);
          b.dataset.fid = id;
          b.addEventListener("click", () => {
            closeDialog();
            onPick(id);
          });
          return b;
        };
        for (const id of ["", ...targets]) list.append(rowFor(id));
        openCard(title, list, h("div", { class: "zn-dialog-actions" }, cancel));
        cancel.addEventListener("click", closeDialog);
      }
      function askFolderMove(node) {
        const span = Math.max(...folderTargets().filter((x) => x === node.id || x.startsWith(node.id + "/")).map(folderDepth), 1) - folderDepth(node.id) + 1;
        const targets = folderTargets(node.id).filter((id) => folderDepth(id) + span <= FOLDER_MAX_DEPTH && id !== parentOfFolder(node.id));
        askFolderPick(`Move \u201c${node.label}\u201d to`, targets, (id) => store.moveFolder(node.id, id), parentOfFolder(node.id));
      }
      // ---- right-click menus (Cycle G #9 / #34 / #39) ----
      const pointAnchor = (e) => ({ getBoundingClientRect: () => ({ left: e.clientX, top: e.clientY, right: e.clientX + 1, bottom: e.clientY + 1, width: 1, height: 1 }) });
      // Where today's quick-capture line goes: { id, body, at } (the note is created when missing, like openDay does).
      function todayCaptureTarget() {
        const { ms, ymd } = dateTarget("today", Date.now());
        if (dateMode() === "single") {
          let j = store.list().find(isJournal);
          if (!j) j = store.create("# " + JOURNAL_TITLE + "\n", "");
          const r = journalSection(j.body, ymd, ms);
          return { id: j.id, body: r.body, at: r.caret };
        }
        let n = findDateNote(store.list(), ymd);
        if (!n) {
          if (!store.meta.folders.some((f) => f.id === DATE_FOLDER)) store.addFolder("Daily");
          n = store.create(dateNoteBody(ms), DATE_FOLDER);
        }
        return { id: n.id, body: n.body, at: undefined };
      }
      // Appends one line to a note through the store (history sees it). id "" = today's note. Returns the note id or "".
      function quickCapture(id, text) {
        const line = captureLine(text, getPref(PREF.CAPTURE_FORMAT, "bullet-time"), Date.now());
        if (!line) return "";
        let body, at;
        if (id) {
          const n = store.get(id);
          if (!n || n.trashed) return "";
          body = n.body;
        } else ({ id, body, at } = todayCaptureTarget());
        store.update(id, insertLineAt(body, line, at), "capture");
        if (id === currentId && view === "editor") openNote(id, { focus: false });
        return id;
      }
      function askQuickCapture(id) {
        const target = id ? store.get(id) : null;
        const d = field(id ? "Add a line to \u201c" + (titleOf(target?.body || "") || "Untitled note") + "\u201d" : "Add a line to today\u2019s note", "", "Thought, task, link\u2026");
        const ok = chip("Add", true);
        const cancel = chip("Cancel");
        openCard("Quick capture", d.row, h("div", { class: "zn-dialog-actions" }, ok, cancel));
        const go = () => {
          if (!d.input.value.trim()) return;
          const done = quickCapture(id, d.input.value);
          closeDialog();
          flash(done ? "Added" : "Nothing added");
          scheduleList();
        };
        ok.addEventListener("click", go);
        d.input.addEventListener("keydown", (ev) => ev.key === "Enter" && go());
        cancel.addEventListener("click", closeDialog);
        d.input.focus({ preventScroll: true });
      }
      function askMoveNote(n) {
        askFolderPick("Move note to folder", folderTargets(), (fid) => { store.setFolder(n.id, fid); applyState(); scheduleList(); }, cleanFolder(n.folder));
      }
      function noteMenuItems(n) {
        if (n.trashed)
          return [
            { icon: "restore", label: "Restore", action: () => { store.restore(n.id); scheduleList(); } },
            { sep: true },
            { icon: "trash", label: "Delete forever", danger: true, action: () => { store.deleteForever(n.id).then(scheduleList); } },
          ];
        return [
          { icon: "note", label: "Open", action: () => openNote(n.id) },
          { icon: "pin", label: n.pinned ? "Unpin" : "Pin", action: () => { store.setPinned(n.id, !n.pinned); scheduleList(); } },
          { icon: "plus", label: "Quick capture here\u2026", action: () => queueMicrotask(() => askQuickCapture(n.id)) },
          { icon: "plus", label: "Quick capture to today\u2019s note\u2026", action: () => queueMicrotask(() => askQuickCapture("")) },
          { sep: true },
          { icon: "folder", label: "Move to folder\u2026", action: () => queueMicrotask(() => askMoveNote(n)) },
          { icon: "duplicate", label: "Duplicate", action: () => { const c = store.create(n.body, n.folder); store.setColor(c.id, n.color); store.setLabel(c.id, n.label); scheduleList(); } },
          { label: "Colour", group: NOTE_COLORS.map((c) => ({ label: c, action: () => { store.setColor(n.id, c); scheduleList(); } })) },
          { icon: "link", label: "Copy link", action: () => { env.copyText?.("[[" + (titleOf(n.body) || "Untitled note") + "]]"); flash("Link copied"); } },
          { sep: true },
          { icon: "trash", label: "Move to trash", danger: true, action: () => { store.trash(n.id); if (n.id === currentId) currentId = ""; scheduleList(); } },
        ];
      }
      function trashMenuItems() {
        const days = Number(getPref(PREF.TRASH_DAYS, TRASH_DAYS));
        return [
          { icon: "trash", label: "Empty trash now", danger: true, disabled: !store.trashCount(), action: () => { store.emptyTrash().then(scheduleList); } },
          { sep: true },
          { label: "Auto-empty after\u2026", group: [[0, "Never"], [7, "7 days"], [14, "14 days"], [30, "30 days"], [90, "90 days"]].map(([v, label]) => ({ label: (v === days ? "\u2713 " : "") + label, action: () => { setPref(PREF.TRASH_DAYS, v); flash(v ? "Applies at the next start: older than " + v + " days" : "Auto-empty is off"); } })) },
        ];
      }
      function askNoteFolder() {
        const n = note();
        if (!n || n.trashed) return;
        askFolderPick("Move note to folder", folderTargets(), (id) => {
          store.setFolder(n.id, id);
          applyState();
          focusEditor();
        }, cleanFolder(n.folder));
      }
      function renderList() {
        rafList = 0;
        if (view !== "list") return;
        applyState();
        const trashed = filter === "trash";
        const keep = listItems.contains?.(document.activeElement) ? document.activeElement?.dataset?.key || "" : "";
        listItems.replaceChildren();
        listItems.setAttribute("role", treeMode() ? "tree" : "list");
        if (treeMode()) renderTree();
        else {
          const all = filter === "recent" ? recentNotes() : store.list({ query, trashed });
          if (trashed) {
            const plan = trashPlan(store.list({ trashed: true }), cleanTrashDays(getPref(PREF.TRASH_DAYS, TRASH_DAYS)), nowMs());
            listItems.append(h("p", { class: "zn-trash-note" }, trashBanner(plan, nowMs())));
          }
          if (!all.length) {
            listItems.append(
              h("p", { class: "zn-empty" }, query ? "No notes match your search." : trashed ? "Trash is empty." : filter === "recent" ? "Nothing opened yet." : "No notes yet. Press + to create one."),
            );
            return;
          }
          for (const n of all.slice(0, MAX_LIST_ROWS)) listItems.append(buildItem(n, trashed));
          if (all.length > MAX_LIST_ROWS)
            listItems.append(h("p", { class: "zn-empty" }, `Showing the first ${MAX_LIST_ROWS} of ${all.length}. Use search to narrow down.`));
        }
        if (keep) [...listItems.children].find((c) => c.dataset?.key === keep)?.focus?.({ preventScroll: true });
      }
      const scheduleList = () => {
        if (!rafList) rafList = window.requestAnimationFrame(renderList);
      };

      // ---- editing ---------------------------------------------------------------
      function applyEdit(e) {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(e.start, e.end);
        const before = ta.value;
        const expected = before.slice(0, e.start) + e.text + before.slice(e.end);
        let done = false;
        try {
          // execCommand keeps the native undo stack intact.
          done =
            e.text === ""
              ? e.start === e.end || document.execCommand("delete")
              : document.execCommand("insertText", false, e.text);
        } catch (_) {}
        if (!done || ta.value !== expected) {
          ta.value = expected; // always correct, but loses undo for this step
          ta.dispatchEvent(new Event("input", { bubbles: true }));
        }
        ta.setSelectionRange(e.selStart, e.selEnd);
      }
      const sel = () => [ta.selectionStart, ta.selectionEnd];
      const hlOpen = () => (store.meta.highlight === "yellow" ? "==" : `=={${store.meta.highlight}}`);
      const fmt = {
        code: () => applyEdit(wrapSelection(ta.value, ...sel(), "`")),
        codeBlock: () => askCodeBlock(),
        numbered: () => applyEdit(toggleLinePrefix(ta.value, ...sel(), "ordered")),
        image: () => askImage(),
        rule: () => applyEdit(insertRule(ta.value, ...sel())),
        sup: () => applyEdit(wrapSelection(ta.value, ...sel(), "^")),
        sub: () => applyEdit(wrapSelection(ta.value, ...sel(), "~")),
        kbd: () => applyEdit(wrapSelection(ta.value, ...sel(), "<kbd>", "</kbd>")),
        link: () => askLink(),
        noteLink: () => askNoteLink(),
        footnote: () => applyEdit(insertFootnote(ta.value, ...sel())),
        hubList: () => askHubList(),
        table: () => askTable(),
        bold: () => applyEdit(wrapSelection(ta.value, ...sel(), "**")),
        italic: () => applyEdit(wrapSelection(ta.value, ...sel(), "*")),
        strike: () => applyEdit(wrapSelection(ta.value, ...sel(), "~~")),
        highlight: () => applyEdit(wrapSelection(ta.value, ...sel(), hlOpen(), "==")),
        heading: () => applyEdit(toggleLinePrefix(ta.value, ...sel(), "heading")),
        bullet: () => applyEdit(toggleLinePrefix(ta.value, ...sel(), "bullet")),
        check: () => applyEdit(toggleLinePrefix(ta.value, ...sel(), "check")),
        quote: () => applyEdit(toggleLinePrefix(ta.value, ...sel(), "quote")),
        indent: () => applyEdit(nestLines(ta.value, ...sel(), 1)),
        outdent: () => applyEdit(nestLines(ta.value, ...sel(), -1)),
      };
      for (const [kind] of CALLOUT_KINDS) fmt[calloutId(kind)] = () => applyEdit(insertCallout(ta.value, ...sel(), kind));
      const needEdit = (fn) => () => {
        if (mode === "read") setMode("edit");
        if (note()?.trashed) return;
        fn();
      };
      for (const [btn, fn] of [[tBold, fmt.bold], [tItalic, fmt.italic], [tStrike, fmt.strike], [tHl, fmt.highlight], [tBullet, fmt.bullet], [tIndent, fmt.indent], [tOutdent, fmt.outdent], [tCode, fmt.code], [tCodeBlock, fmt.codeBlock], [tNumbered, fmt.numbered], [tLink, fmt.link], [tNoteLink, fmt.noteLink], [tImage, fmt.image], [tTable, fmt.table]]) {
        // mousedown must not steal the textarea selection
        listen(btn, "mousedown", (e) => e.preventDefault());
        listen(btn, "click", needEdit(fn));
      }
      // Hold-to-pick variants: a tap keeps the old action, a long press opens the choices (task states, heading levels).
      const calloutVariants = () => CALLOUT_KINDS.filter(([k]) => !hiddenTools().has(calloutId(k))).map(([k, label]) => ({ label, action: needEdit(fmt[calloutId(k)]) }));
      for (const [btn, tap, variants, noEdit] of [
        // Quote and the "More" caret: a tap is what it always was, holding lists the callout kinds (a callout is a quote with a marker).
        [tQuote, fmt.quote, calloutVariants],
        [tInsert, () => showInsertMenu(), calloutVariants, true],
        [tCheck, fmt.check, () => TASK_STATUSES.map(([ch, name]) => ({ icon: "check", label: "[" + ch + "]  " + name, action: needEdit(() => applyEdit(setTaskStatus(ta.value, ...sel(), ch))) }))],
        [tHeading, fmt.heading, () => [1, 2, 3, 4, 5, 6].map((n) => ({ icon: "heading", label: "Heading " + n + "  (" + "#".repeat(n) + ")", action: needEdit(() => applyEdit(setHeadingLevel(ta.value, ...sel(), n))) }))],
      ]) {
        listen(btn, "mousedown", (e) => e.preventDefault());
        const hold = createHoldAction({ setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: (id) => window.clearTimeout(id), onTap: noEdit ? tap : needEdit(tap), onHold: () => { const items = variants(); if (items.length) showMenu(btn, items); else (noEdit ? tap : needEdit(tap))(); } });
        listen(btn, "pointerdown", (e) => { if (e.button === undefined || e.button === 0) hold.press(); });
        listen(btn, "pointerup", () => hold.release());
        listen(btn, "pointerleave", () => hold.cancel());
        listen(btn, "click", () => hold.click());
        cleanups.push(() => hold.cancel());
      }
      listen(tMode, "click", () => setMode(mode === "read" ? "edit" : "read"));
      // Linked scrolling (split view only): the pane you scroll puts the same SOURCE line at the top of
      // the other. Each pane has its own line heights (and the editor wraps), so the position is mapped
      // line by line: editor offset <-> source line <-> rendered block, interpolated between the two
      // nearest known lines. Without layout information it falls back to the proportional position.
      // One frame of lock keeps the two scroll events from chasing each other.
      let syncLock = false;
      let rafSync = 0;
      function measureEditor() {
        const gcs = window.getComputedStyle;
        if (typeof gcs !== "function") return null;
        if (!mirror) {
          mirror = h("div", { class: "zn-mirror", "aria-hidden": "true" });
          root.append(mirror);
        }
        const cs = gcs(ta);
        for (const k of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderLeftWidth", "borderRightWidth", "whiteSpace", "overflowWrap", "wordBreak", "boxSizing"])
          mirror.style[k] = cs[k];
        mirror.style.width = ta.clientWidth + "px";
        mirror.replaceChildren();
        const lines = ta.value.split("\n");
        const rows = lines.map((l) => h("div", {}, l || "\u200b"));
        mirror.append(...rows);
        const out = rows.map((r, i) => ({ line: i, y: r.offsetTop }));
        mirror.replaceChildren();
        return mergeAnchors(out, lines.length, ta.scrollHeight);
      }
      function measureRead() {
        const base = readEl.getBoundingClientRect().top - readEl.scrollTop;
        return mergeAnchors(
          readAnch.map((a) => ({ line: a.line, y: Math.max(0, a.node.getBoundingClientRect().top - base) })),
          ta.value.split("\n").length,
          readEl.scrollHeight,
        );
      }
      const atEnd = (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      const linkScroll = (from, to) => () => {
        if (mode !== "split" || !store.meta.syncScroll || syncLock) return;
        const max = from.scrollHeight - from.clientHeight;
        if (!(max > 0)) return;
        syncLock = true;
        let target = null;
        try {
          if (from.scrollTop > 0 && !atEnd(from) && readAnch.length) {
            taAnchY = taAnchY || measureEditor();
            readAnchY = readAnchY || measureRead();
            if (taAnchY && readAnchY) {
              const fromEditor = from === ta;
              const line = mapPosition(fromEditor ? taAnchY : readAnchY, from.scrollTop, "y", "line");
              target = mapPosition(fromEditor ? readAnchY : taAnchY, line, "line", "y");
            }
          }
        } catch (_) {
          target = null;
        }
        if (target === null) target = (from.scrollTop / max) * Math.max(0, to.scrollHeight - to.clientHeight);
        to.scrollTop = target;
        if (!rafSync)
          rafSync = window.requestAnimationFrame(() => {
            rafSync = 0;
            syncLock = false;
          });
      };
      listen(ta, "scroll", linkScroll(ta, readEl));
      listen(ta, "scroll", syncBackdropScroll);
      listen(readEl, "scroll", linkScroll(readEl, ta));
      listen(tSync, "click", () => {
        store.setMeta({ syncScroll: !store.meta.syncScroll });
        applyState();
      });
      listen(tSplit, "click", () => setMode(mode === "split" ? "edit" : "split"));
      listen(tRule, "mousedown", (e) => e.preventDefault());
      listen(tRule, "click", needEdit(fmt.rule));
      // The "More" menu. Opened by a tap on the caret (see the hold list above: holding it lists the callouts instead).
      function showInsertMenu() {
        showMenu(tInsert, [
          { icon: "image", label: "Paste picture from clipboard", action: needEdit(pastePictureFromClipboard) },
          { icon: "image", label: "Picture options\u2026 (size, alignment)", action: needEdit(askPictureOptions) },
          { sep: true },
          ...(CALLOUT_KINDS.some(([k]) => !hiddenTools().has(calloutId(k))) ? [{ label: "Callout\u2026", action: () => queueMicrotask(showCalloutMenu) }] : []),
          { sep: true },
          { label: "Superscript  X^2^", action: needEdit(fmt.sup), id: "sup" },
          { label: "Subscript  H~2~O", action: needEdit(fmt.sub), id: "sub" },
          { label: "Keyboard key  <kbd>", action: needEdit(fmt.kbd), id: "kbd" },
          { sep: true },
          { label: "Footnote  [^1]", action: needEdit(fmt.footnote), id: "footnote" },
          { label: "Hub list of notes\u2026", action: needEdit(fmt.hubList), id: "hubList" },
        ].filter((it) => !it.id || !hiddenTools().has(it.id)));
      }
      // Cycle F #11: one "Callout..." entry instead of six; this menu lists the kinds (hidden ones stay out).
      function showCalloutMenu() {
        showMenu(tInsert, CALLOUT_KINDS.filter(([k]) => !hiddenTools().has(calloutId(k))).map(([k, label]) => ({ label, action: needEdit(fmt[calloutId(k)]) })));
      }
      listen(tSettings, "click", () => askSettings());

      // ---- menus -----------------------------------------------------------------
      function closeMenu() {
        if (!menu) return;
        menu.el.remove();
        menu = null;
      }
      // Keeps a menu fully inside both the sheet and the window: it is right-aligned to its anchor,
      // shifted back in when that would cross an edge, flipped above the anchor when there is no room
      // below, and scrolls when it is taller than the space (a narrow sheet or a window edge used to
      // crop the highlight colors).
      function placeMenu(m, anchor) {
        const doc = root.ownerDocument.documentElement;
        const pos = menuPosition({
          anchor: anchor.getBoundingClientRect(),
          host: root.getBoundingClientRect(),
          viewport: { width: doc.clientWidth || Infinity, height: doc.clientHeight || Infinity },
          size: { width: m.offsetWidth || 0, height: m.offsetHeight || 0 },
        });
        if (pos.maxHeight) m.style.maxHeight = pos.maxHeight + "px";
        m.style.left = pos.left + "px";
        m.style.top = pos.top + "px";
      }
      function showMenu(anchor, items) {
        if (menu && menu.anchor === anchor) return closeMenu();
        closeMenu();
        const m = h("div", { class: "zn-menu", role: "menu" });
        // One entry list per level: an item with `group` opens its entries in place (with a Back row) so a long
        // menu stays short; closing the menu from any level runs the chosen action once.
        const fill = (list, parent) => {
          m.replaceChildren();
          if (parent) {
            const back = h("button", { type: "button", class: "zn-menu-item zn-menu-back", role: "menuitem" });
            back.append(icon("back"), h("span", {}, "Back"));
            back.addEventListener("click", () => {
              fill(parent.list, parent.parent);
              placeMenu(m, anchor);
              m.querySelector("button")?.focus({ preventScroll: true });
            });
            m.append(back, h("div", { class: "zn-sep" }));
          }
          for (const it of list) {
            if (it.sep) m.append(h("div", { class: "zn-sep" }));
            else if (it.swatches) {
              const row = h("div", { class: "zn-swatches" });
              for (const c of it.swatches) {
                const b = h("button", { type: "button", class: "zn-swatch", title: c, "aria-label": c });
                b.dataset.color = c;
                if (c === it.current) b.classList.add("is-on");
                b.addEventListener("click", () => {
                  closeMenu();
                  it.pick(c);
                });
                row.append(b);
              }
              m.append(row);
            } else if (it.disabled) {
              // A heading or a note ("No other note links here"): not a button, never focused or clicked.
              m.append(h("div", { class: "zn-menu-item zn-menu-head", role: "presentation", "aria-disabled": "true" }, it.label));
            } else if (it.group) {
              const b = h("button", { type: "button", class: "zn-menu-item zn-menu-group", role: "menuitem", "aria-haspopup": "menu" });
              if (it.icon) b.append(icon(it.icon));
              b.append(h("span", {}, it.label), icon("chevron"));
              b.addEventListener("click", () => {
                fill(it.group, { list, parent });
                placeMenu(m, anchor);
                m.querySelector("button")?.focus({ preventScroll: true });
              });
              m.append(b);
            } else {
              const b = h("button", { type: "button", class: "zn-menu-item" + (it.danger ? " is-danger" : ""), role: "menuitem" });
              if (it.icon) b.append(icon(it.icon));
              b.append(h("span", {}, it.label));
              b.addEventListener("click", () => {
                closeMenu();
                it.action();
              });
              m.append(b);
            }
          }
        };
        fill(items, null);
        // Keyboard: Up / Down / Home / End move between the entries (Tab still works, Esc closes).
        m.addEventListener("keydown", (ev) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
          const btns = [...m.querySelectorAll("button")];
          if (!btns.length) return;
          const at = btns.indexOf(ev.target);
          const next = ev.key === "Home" ? 0 : ev.key === "End" ? btns.length - 1 : ev.key === "ArrowDown" ? (at + 1) % btns.length : (at - 1 + btns.length) % btns.length;
          ev.preventDefault();
          btns[next].focus({ preventScroll: true });
        });
        m.style.visibility = "hidden";
        root.append(m);
        placeMenu(m, anchor);
        m.style.visibility = "";
        menu = { el: m, anchor };
        m.querySelector("button")?.focus({ preventScroll: true });
      }
      listen(root, "pointerdown", (e) => {
        if (menu && !menu.el.contains(e.target) && !menu.anchor.contains(e.target)) closeMenu();
      }, true);
      // Export notice: says what each format loses before anything is written.
      function closeDialog() {
        if (!dialog) return;
        try {
          cardRO?.disconnect();
        } catch (_) {}
        cardRO = null;
        window.cancelAnimationFrame(rafFit);
        rafFit = 0;
        delete root.dataset.dialogSpill;
        dialog.remove();
        dialog = null;
      }
      // V4-QS: a dialog card is sized in em/ch (it follows the sheet font) and, when it is bigger than the sheet,
      // grows past it up to the window (fitDialog). Re-run after every redraw and when the card resizes.
      let cardRO = null;
      let rafFit = 0;
      let fitting = false;
      const FIT_PROPS = ["position", "left", "top", "width", "height", "maxWidth", "maxHeight"];
      function fitCard() {
        if (!dialog) return null;
        const card = dialog.querySelector(".zn-dialog-card");
        if (!card || card.classList.contains("zn-settings")) return null;
        fitting = true;
        window.requestAnimationFrame(() => (fitting = false));
        const doc = (root.ownerDocument || document).documentElement || {};
        const viewport = { width: doc.clientWidth || window.innerWidth || 0, height: doc.clientHeight || window.innerHeight || 0 };
        for (const k of FIT_PROPS) card.style[k] = "";
        delete dialog.dataset.spill;
        delete root.dataset.dialogSpill;
        if (viewport.width > 0) card.style.maxWidth = "min(34em, " + Math.max(120, viewport.width - 12) + "px)";
        const size = { width: Math.max(card.offsetWidth || 0, card.scrollWidth || 0), height: Math.max(card.offsetHeight || 0, card.scrollHeight || 0) };
        const sr = root.getBoundingClientRect();
        const sheet = { left: sr.left, top: sr.top, width: sr.width, height: sr.height };
        const fit = viewport.width > 0 ? fitDialog({ sheet, viewport, size }) : { spill: false };
        card.style.maxWidth = "";
        if (fit.spill) {
          dialog.dataset.spill = "true";
          root.dataset.dialogSpill = "true";
          card.style.position = "absolute";
          card.style.left = fit.left + "px";
          card.style.top = fit.top + "px";
          card.style.width = fit.width + "px";
          card.style.height = fit.height + "px";
          card.style.maxWidth = "none";
          card.style.maxHeight = "none";
        }
        return fit;
      }
      const scheduleFit = () => {
        if (!rafFit) rafFit = window.requestAnimationFrame(() => {
          rafFit = 0;
          fitCard();
        });
      };
      // Demo notes (Cycle F #3): More > Install demo notes. Idempotent by fixed ids; edits and trashing are respected.
      // ---- templates (Cycle G #35) ----
      function ensureTemplatesFolder() {
        return store.meta.folders.some((f) => f.id === TEMPLATE_FOLDER) ? TEMPLATE_FOLDER : store.addFolder("Templates") || "";
      }
      function newFromTemplate(tpl, title) {
        const out = applyTemplate(tpl.body, { now: Date.now(), title });
        const n = store.create(out.body, "");
        mode = "edit";
        store.setMeta({ mode: "edit" });
        openNote(n.id);
        try {
          ta.value = store.get(n.id).body;
          ta.setSelectionRange(out.caret, out.caret);
          revealSourceMatch({ start: out.caret, end: out.caret });
        } catch (_) {}
      }
      function pickTemplate(tpl) {
        if (!templateNeedsTitle(tpl.body)) return newFromTemplate(tpl, "");
        const f = field("Title", "", tpl.name);
        const ok = chip("Create", true), cancel = chip("Cancel");
        openCard("New " + tpl.name.toLowerCase() + " note", f.row, h("div", { class: "zn-dialog-actions" }, cancel, ok));
        const go = () => { const t = f.input.value; closeDialog(); newFromTemplate(tpl, t); };
        ok.addEventListener("click", go);
        cancel.addEventListener("click", closeDialog);
        f.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
        f.input.focus({ preventScroll: true });
      }
      const templateMenuItems = () => templateChoices(store.list()).map((t) => ({ icon: "note", label: t.name + (t.builtin ? "" : "  \u2605"), action: () => queueMicrotask(() => pickTemplate(t)) }));
      function showTemplateMenu(anchor) {
        const items = templateMenuItems();
        items.push({ sep: true }, { icon: "folder", label: "Templates are notes in the Templates folder", disabled: true });
        showMenu(anchor, items);
      }
      function saveAsTemplate() {
        const n = note();
        if (!n || n.trashed) return;
        const folder = ensureTemplatesFolder();
        if (!folder) return flash("Could not create the Templates folder");
        const c = store.create(n.body, folder);
        flash("Saved as a template: " + (titleOf(c.body) || "Untitled"));
        if (view === "list") scheduleList();
      }
      function installDemoNotes() {
        let made = 0;
        const folder = store.meta.folders.some((f) => f.id === DEMO_FOLDER) ? DEMO_FOLDER : store.addFolder("Help") || "";
        for (const d of DEMO_NOTES) if (store.ensureNote(d.id, d.body, folder).created) made++;
        flash(made ? `Installed ${made} demo ${made === 1 ? "note" : "notes"} in the Help folder` : "Demo notes are already installed");
        const first = store.get(DEMO_NOTES[0].id);
        if (first && !first.trashed) openNote(first.id);
      }
      // Labels dialog (Cycle F #19): every label with its note count; rename (naming an existing label merges them) and remove.
      // More > Check links (Cycle G #36): lists links that lead nowhere; nothing changes until a button is pressed.
      function askLinkCheck() {
        const rows = h("div", { class: "zn-labels zn-linkcheck" });
        const close = chip("Close");
        const REASON = { "missing-note": "no such note", trashed: "note is in the Trash", "missing-heading": "heading not found" };
        const paint = () => {
          rows.replaceChildren();
          const list = findBrokenLinks(store.list());
          if (!list.length) rows.append(h("p", { class: "zn-hint" }, "No broken links found."));
          for (const it of list) {
            const src = store.get(it.noteId);
            const open = chip("Open"), unlink = chip("Unlink");
            const kids = [open];
            if (it.kind === "missing-note") {
              const make = chip("Create");
              make.title = "Create the missing note";
              make.addEventListener("click", () => {
                if (it.targetId) store.ensureNote(it.targetId, "# " + (it.label || it.targetId) + "\n\n", "");
                else store.create("# " + it.title + "\n\n", "");
                paint();
              });
              kids.push(make);
            }
            kids.push(unlink);
            open.addEventListener("click", () => { closeDialog(); openNote(it.noteId); });
            unlink.title = "Keep the text, remove the link";
            unlink.addEventListener("click", () => {
              const cur = store.get(it.noteId);
              if (cur) store.update(it.noteId, unlinkBroken(cur.body, it), "links");
              paint();
            });
            rows.append(h("div", { class: "zn-labels-row zn-linkcheck-row" },
              h("span", { class: "zn-labels-name", title: it.raw }, (titleOf(src?.body || "") || "Untitled note") + " \u2192 " + (it.title || it.label) + (it.anchor ? " #" + it.anchor : "")),
              h("span", { class: "zn-labels-count" }, REASON[it.kind] || it.kind),
              h("span", { class: "zn-labels-actions" }, ...kids)));
          }
        };
        paint();
        openCard("Check links", rows, h("div", { class: "zn-dialog-actions" }, close));
        close.addEventListener("click", closeDialog);
      }
      function askLabels() {
        const rows = h("div", { class: "zn-labels" });
        const close = chip("Close");
        const paint = () => {
          rows.replaceChildren();
          const list = labelSummary(store.list());
          if (!list.length) rows.append(h("p", { class: "zn-hint" }, "No labels yet. Use More > Add label on a note."));
          for (const { label, count } of list) {
            const ren = chip("Rename"), del = chip("Remove");
            ren.title = "Rename (type an existing label to merge)";
            del.title = "Remove this label from its notes";
            rows.append(h("div", { class: "zn-labels-row" }, h("span", { class: "zn-labels-name", title: label }, label), h("span", { class: "zn-labels-count" }, String(count)), h("span", { class: "zn-grow" }), ren, del));
            ren.addEventListener("click", () => askRename(label));
            del.addEventListener("click", () => {
              const k = store.renameLabel(label, "");
              flash(`Removed the label from ${k} ${k === 1 ? "note" : "notes"}`);
              afterLabels();
              paint();
            });
          }
        };
        const afterLabels = () => { applyState(); if (view === "list") scheduleList(); };
        function askRename(old) {
          const f = field("New name", old, "label");
          f.input.maxLength = LABEL_MAX;
          const ok = chip("Rename", true), back = chip("Back");
          openCard("Rename label", f.row, h("p", { class: "zn-hint" }, "Typing the name of another label merges the two."), h("div", { class: "zn-dialog-actions" }, back, ok));
          const go = () => {
            const to = f.input.value;
            const exists = labelSummary(store.list()).some((x) => x.label.toLowerCase() === cleanLabel(to).toLowerCase() && x.label.toLowerCase() !== old.toLowerCase());
            const k = store.renameLabel(old, to);
            flash(k ? `${exists ? "Merged" : "Renamed"} on ${k} ${k === 1 ? "note" : "notes"}` : "Nothing changed");
            afterLabels();
            askLabels();
          };
          ok.addEventListener("click", go);
          back.addEventListener("click", () => askLabels());
          f.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
          f.input.focus({ preventScroll: true });
          f.input.select?.();
        }
        openCard("Labels", rows, h("div", { class: "zn-dialog-actions" }, close));
        close.addEventListener("click", () => { closeDialog(); focusEditor(); });
        paint();
      }
      // Free-text label of the note (one short line, shown beside the title and in the list, searchable).
      function askLabel() {
        const n = note();
        if (!n || n.trashed) return;
        const f = field("Label", n.label || "", "e.g. work, ideas, shopping");
        f.input.maxLength = LABEL_MAX;
        const ok = chip("Save", true);
        const clear = chip("Remove label");
        const cancel = chip("Cancel");
        openCard("Note label", f.row, h("div", { class: "zn-dialog-actions" }, cancel, clear, ok));
        const save = (v) => {
          store.setLabel(n.id, v);
          closeDialog();
          applyState();
          if (view === "list") scheduleList();
          focusEditor();
        };
        ok.addEventListener("click", () => save(f.input.value));
        clear.addEventListener("click", () => save(""));
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        f.input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save(f.input.value);
          }
        });
        f.input.focus({ preventScroll: true });
        f.input.select?.();
      }
      listen(labelEl, "click", () => askLabel());
      function askExport(format, run) {
        closeMenu();
        closeDialog();
        const info = EXPORT_FORMATS[format];
        const ok = h("button", { type: "button", class: "zn-chip is-on" }, format === "pdf" ? "Open print dialog" : "Choose where to save\u2026");
        const cancel = h("button", { type: "button", class: "zn-chip" }, "Cancel");
        const card = h(
          "div",
          { class: "zn-dialog-card", role: "alertdialog", "aria-label": "Export as " + info.label },
          h("strong", {}, "Export as " + info.label),
          h("p", {}, info.loses),
          h("div", { class: "zn-dialog-actions" }, cancel, ok),
        );
        dialog = h("div", { class: "zn-dialog" }, card);
        cancel.addEventListener("click", closeDialog);
        ok.addEventListener("click", () => {
          closeDialog();
          Promise.resolve(run()).catch((error) => console.warn("[ZentralNotes] export failed", error));
        });
        dialog.addEventListener("pointerdown", (e) => {
          if (e.target === dialog) closeDialog();
        });
        root.append(dialog);
        ok.focus({ preventScroll: true });
      }

      // ---- small dialogs: link, table, quick settings, shortcuts ---------------------------------------
      function openCard(label, ...kids) {
        closeMenu();
        closeDialog();
        const card = h("div", { class: "zn-dialog-card", role: "dialog", "aria-label": label }, h("strong", {}, label), ...kids);
        dialog = h("div", { class: "zn-dialog" }, card);
        dialog.addEventListener("pointerdown", (e) => {
          if (e.target === dialog) closeDialog();
        });
        root.append(dialog);
        fitCard();
        try {
          const RO = window.ResizeObserver;
          if (RO) {
            cardRO = new RO(() => {
              if (!fitting) scheduleFit();
            });
            cardRO.observe(card);
          }
        } catch (_) {}
        return card;
      }
      const chip = (label, on = false) => h("button", { type: "button", class: "zn-chip" + (on ? " is-on" : "") }, label);
      const field = (label, value, placeholder = "") => {
        const input = h("input", { type: "text", class: "zn-field", spellcheck: "false", "aria-label": label, placeholder });
        input.value = value;
        return { input, row: h("label", { class: "zn-field-row" }, h("span", {}, label), input) };
      };
      // Fills an empty address field from the clipboard when it holds one address `accept` approves.
      // Asynchronous and best effort: a refused or empty clipboard changes nothing.
      function prefillFromClipboard(input, accept, onFill) {
        try {
          const nav = window.navigator;
          Promise.resolve(nav?.clipboard?.readText?.())
            .then((text) => {
              const found = input.value ? null : accept(text);
              if (!found || !dialog) return;
              input.value = found;
              input.select?.();
              onFill?.(found);
            })
            .catch(() => {});
        } catch (_) {}
      }
      // Link dialog: text to show + address, like the one in a forum editor. `pasted` is set when it was
      // opened by pasting an address (then "Paste as text" keeps the address as plain text).
      function askLink({ pasted = "", s: ps, e: pe } = {}) {
        if (note()?.trashed) return;
        if (mode === "read") setMode("edit");
        const [s, e] = ps === undefined ? sel() : [ps, pe];
        const selected = ta.value.slice(s, e);
        const selIsUrl = pastedLink(selected);
        const url = pasted || selIsUrl || "";
        const text = pasted ? selected || fragmentLabel(pasted) : selIsUrl ? fragmentLabel(selIsUrl) : selected;
        const t = field("Text to show", text, "Text to show");
        const a = field("Address", url, "https://");
        const ok = chip("Create link", true);
        const cancel = chip("Cancel");
        const buttons = [cancel];
        if (pasted) {
          const plain = chip("Paste as text");
          plain.addEventListener("click", () => {
            closeDialog();
            applyEdit({ start: s, end: e, text: pasted, selStart: s + pasted.length, selEnd: s + pasted.length });
          });
          buttons.push(plain);
        }
        buttons.push(ok);
        const card = openCard("Create link", t.row, a.row, h("div", { class: "zn-dialog-actions" }, ...buttons));
        const submit = () => {
          const href = safeHref(a.input.value.trim());
          if (!href) {
            a.input.dataset.bad = "true";
            a.input.focus();
            return;
          }
          closeDialog();
          applyEdit(insertLink(ta.value, s, e, t.input.value.trim() || a.input.value.trim(), a.input.value.trim()));
        };
        ok.addEventListener("click", submit);
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        for (const f of [t, a]) f.input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            submit();
          }
        });
        (text || !url ? (text ? a : t) : t).input.focus({ preventScroll: true });
        if (!url) prefillFromClipboard(a.input, pastedLink, (u) => { if (!t.input.value) t.input.value = fragmentLabel(u); });
        return card;
      }
      // Link to another note: pick from the notes (search by words in the title or text). The link stores the
      // note's stable id, so it still works after the note is renamed or moved to another folder.
      function askNoteLink() {
        if (note()?.trashed) return;
        if (mode === "read") setMode("edit");
        const [s, e] = sel();
        const selected = ta.value.slice(s, e).replace(/\s+/g, " ").trim();
        const q = field("Find a note", "", "Type to search notes");
        const rows = h("div", { class: "zn-noteset", role: "listbox", "aria-label": "Notes to link to" });
        const cancel = chip("Cancel");
        const card = openCard("Link to another note", q.row, rows, h("div", { class: "zn-dialog-actions" }, cancel));
        const pick = (t, slug = "") => {
          closeDialog();
          applyEdit(insertNoteLink(ta.value, s, e, t.id, selected || titleOf(t.body) || "Untitled note", slug));
        };
        // "#" beside a note: choose one of its headings, so the link opens at that place.
        const pickHeading = (t) => {
          rows.replaceChildren();
          const mk = (label, slug) => {
            const b = h("button", { type: "button", class: "zn-menu-item", role: "option" }, label);
            b.addEventListener("click", () => pick(t, slug));
            rows.append(b);
          };
          mk("Whole note", "");
          for (const hd of headingsOf(t.body)) mk("#".repeat(hd.level) + " " + hd.text, hd.slug);
          rows.querySelector?.("button")?.focus?.();
        };
        const draw = () => {
          rows.replaceChildren();
          const words = q.input.value.trim();
          const hits = store.list({ query: words }).filter((t) => t.id !== currentId).slice(0, 40);
          if (!hits.length) rows.append(h("p", { class: "zn-empty" }, "No other note matches."));
          for (const t of hits) {
            const b = h("button", { type: "button", class: "zn-menu-item", role: "option" }, titleOf(t.body) || "Untitled note");
            if (t.folder) b.title = "In folder " + t.folder;
            b.addEventListener("click", () => pick(t));
            rows.append(b);
            if (headingsOf(t.body).length > 1) {
              const hb = h("button", { type: "button", class: "zn-pick-head", title: "Link to a heading in this note", "aria-label": "Link to a heading in " + (titleOf(t.body) || "this note") }, "#");
              hb.addEventListener("click", () => pickHeading(t));
              rows.append(hb);
            }
          }
        };
        q.input.addEventListener("input", draw);
        q.input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            rows.querySelector?.("button")?.click();
          } else if (ev.key === "ArrowDown") {
            ev.preventDefault();
            rows.querySelector?.("button")?.focus?.();
          }
        });
        rows.addEventListener("keydown", (ev) => {
          const list = [...(rows.querySelectorAll?.("button") || [])];
          const i = list.indexOf(ev.target);
          if (ev.key === "ArrowDown" && list[i + 1]) { ev.preventDefault(); list[i + 1].focus(); }
          else if (ev.key === "ArrowUp") { ev.preventDefault(); (list[i - 1] || q.input).focus(); }
        });
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        draw();
        q.input.focus({ preventScroll: true });
        return card;
      }
      function paintLinked() {
        const n = note();
        linkedEl.replaceChildren();
        linkedEl.hidden = true;
        if (!getPref(PREF.BACKLINKS_PANEL, false) || !n || n.trashed || view !== "editor" || mode === "edit") return;
        const { linked } = findBacklinks(store.list(), n);
        if (!linked.length) return;
        linkedEl.append(h("span", { class: "zn-linked-label" }, "Linked from"));
        for (const t of linked.slice(0, 12)) {
          const b = h("button", { type: "button", class: "zn-chip" }, titleOf(t.body) || "Untitled note");
          b.addEventListener("click", () => openNote(t.id, { focus: false }));
          linkedEl.append(b);
        }
        linkedEl.hidden = false;
      }
      // Hub list: a bulleted list of links to notes (all, or one folder), each with the note's short description.
      function askHubList() {
        if (note()?.trashed) return;
        const [s, e] = sel();
        const put = (folder) => {
          const text = hubLines(store.list(), { folder, excludeId: currentId });
          if (!text) return flash("No notes to list there");
          applyEdit({ start: s, end: e, text: text + "\n", selStart: s + text.length + 1, selEnd: s + text.length + 1 });
        };
        const folders = allFolderIds(store.list(), store.meta.folders);
        queueMicrotask(() =>
          showMenu(tInsert, [
            { label: "List of", disabled: true },
            { icon: "note", label: "All notes", action: () => put(null) },
            { icon: "note", label: "Notes without a folder", action: () => put("") },
            ...folders.slice(0, 30).map((fid) => ({ icon: "folder", label: "Folder " + fid, action: () => put(fid) })),
          ]),
        );
      }
      // ---- date notes: today / tomorrow / next work day --------------------------------------------------------
      const dateMode = () => cleanDateMode(getPref(PREF.DATE_MODE, "separate"));
      function openDay(ms, ymd) {
        if (dateMode() === "single") {
          let j = store.list().find(isJournal);
          if (!j) j = store.create("# " + JOURNAL_TITLE + "\n", "");
          const r = journalSection(j.body, ymd, ms);
          if (r.body !== j.body) store.update(j.id, r.body);
          openNote(j.id);
          if (mode === "read") setMode("edit");
          ta.value = store.get(j.id).body;
          ta.setSelectionRange(r.caret, r.caret);
          revealSourceMatch({ start: r.caret, end: r.caret });
          return;
        }
        let n = findDateNote(store.list(), ymd);
        if (!n) {
          if (!store.meta.folders.some((f) => f.id === DATE_FOLDER)) store.addFolder("Daily");
          n = store.create(dateNoteBody(ms), DATE_FOLDER);
        }
        openNote(n.id);
      }
      function openDateNote(kind) {
        const { ms, ymd } = dateTarget(kind, Date.now());
        openDay(ms, ymd);
      }
      function askOtherDate() {
        const d = field("Date (YYYY-MM-DD)", ymdOf(Date.now()), "2026-11-03");
        const ok = chip("Open", true);
        const cancel = chip("Cancel");
        openCard("Note for a date", d.row, h("div", { class: "zn-dialog-actions" }, ok, cancel));
        const go = () => {
          const ms = parseYmd(d.input.value);
          if (!ms) return flash("Use the form 2026-11-03");
          closeDialog();
          openDay(ms, ymdOf(ms));
        };
        ok.addEventListener("click", go);
        d.input.addEventListener("keydown", (ev) => ev.key === "Enter" && go());
        cancel.addEventListener("click", closeDialog);
        d.input.focus({ preventScroll: true });
      }
      function showDateMenu() {
        const now = Date.now();
        const items = DATE_KINDS.map(([k, label]) => ({ icon: "bell", label: label + "  " + dateTarget(k, now).ymd, action: () => openDateNote(k) }));
        items.push({ icon: "bell", label: "Other date\u2026", action: () => queueMicrotask(askOtherDate) }, { sep: true });
        const days = dateMode() === "single" ? (store.list().find(isJournal) ? journalDays(store.list().find(isJournal).body).slice(-15).reverse().map((ymd) => ({ ymd })) : []) : listDateNotes(store.list()).slice(0, 15);
        if (days.length) items.push({ label: "Earlier days", disabled: true }, ...days.map((d) => ({ icon: "note", label: d.ymd, action: () => openDay(parseYmd(d.ymd), d.ymd) })));
        showMenu(btnMore, items);
      }
      // ---- pinned strip + Recent menu (Cycle F #29): off by default, rebuilt only when what it shows changed ----
      let stripSig = "";
      function paintStrip() {
        const on = getPref(PREF.PIN_STRIP, false) === true && view === "editor" && !!note();
        const m = on ? stripModel(store.list(), store.meta.recent, currentId) : { pinned: [], recent: [] };
        const sig = on ? JSON.stringify([m.pinned, m.recent.length, currentId]) : "";
        strip.hidden = !on || (!m.pinned.length && !m.recent.length);
        if (sig === stripSig) return;
        stripSig = sig;
        strip.replaceChildren();
        if (strip.hidden) return;
        for (const p of m.pinned) {
          const b = h("button", { type: "button", class: "zn-chip zn-strip-pin" + (p.id === currentId ? " is-on" : ""), title: p.title }, p.title);
          b.dataset.id = p.id;
          b.addEventListener("click", () => openNote(p.id));
          strip.append(b);
        }
        if (m.recent.length) {
          const r = h("button", { type: "button", class: "zn-chip zn-strip-recent", "aria-haspopup": "menu" }, "Recent \u25be");
          r.addEventListener("click", () => showMenu(r, m.recent.map((x) => ({ icon: "note", label: x.title, action: () => openNote(x.id) }))));
          strip.append(h("span", { class: "zn-grow" }), r);
        }
      }
      // ---- outline (Cycle F #27): a menu of the note's headings; choosing one scrolls both panes to it ----
      function showOutline() {
        const n = note();
        if (!n || view !== "editor") return;
        const caret = mode !== "read" ? lineOfOffset(ta.value, ta.selectionStart || 0) : -1;
        const o = outlineItems(mode !== "read" ? ta.value : n.body, caret);
        const items = o.items.map((x) => ({
          icon: x.current ? "pin" : undefined,
          label: "\u2003".repeat(x.level - 1) + x.text,
          action: () => goHeading(x.slug),
        }));
        if (!items.length) items.push({ label: "No headings in this note (lines starting with #)", disabled: true });
        if (o.more) items.push({ label: `\u2026and ${o.more} more headings`, disabled: true });
        showMenu(btnMore, items);
      }
      // ---- version history -----------------------------------------------------------------------------------------
      async function askHistory() {
        const n = note();
        if (!n || n.trashed) return;
        const o = historyOptions({ keep: getPref(PREF.HISTORY_KEEP, 20), minutes: getPref(PREF.HISTORY_MINUTES, 10), capKB: getPref(PREF.HISTORY_CAP_KB, 512), warnMB: getPref(PREF.HISTORY_WARN_MB, 100) });
        const list = await store.listHistory(n.id);
        const usage = await store.historyUsage();
        const rows = h("div", { class: "zn-noteset", role: "list" });
        if (!getPref(PREF.HISTORY_ON, true)) rows.append(h("p", { class: "zn-empty" }, "Version history is switched off in the settings; existing versions stay available."));
        if (!list.length) rows.append(h("p", { class: "zn-empty" }, "No earlier versions yet. While you edit, a version is kept at most every " + o.minutes + " minutes."));
        for (const v of list) {
          const row = h("div", { class: "zn-hist-row" });
          row.append(h("span", { class: "zn-hist-when" }, new Date(v.ms).toLocaleString() + " \u00b7 " + Math.max(1, Math.round(v.size / 1024)) + " KB"));
          const restore = chip("Restore");
          const copy = chip("As new note");
          restore.addEventListener("click", async () => {
            closeDialog();
            if (await store.restoreVersion(n.id, v.name)) {
              showNote(n.id);
              flash("Restored. The text from before is the newest version in the list.");
            } else flash("That version could not be read");
          });
          copy.addEventListener("click", async () => {
            const body = await store.readVersion(n.id, v.name);
            if (body === null) return flash("That version could not be read");
            closeDialog();
            openNote(store.create(body, n.folder).id);
          });
          row.append(restore, copy);
          rows.append(row);
        }
        const warn = historyWarning({ bytes: usage.bytes, warnMB: o.warnMB });
        const info = h("p", { class: "zn-hist-note" }, "All history: " + (usage.bytes / 1048576).toFixed(1) + " MB in " + usage.files + " files." + (warn ? " " + warn : ""));
        if (warn) info.classList.add("is-warn");
        const clear = chip("Clear this note's history");
        const close = chip("Close", true);
        clear.addEventListener("click", async () => {
          await store.clearHistory(n.id);
          closeDialog();
          flash("History of this note cleared");
        });
        close.addEventListener("click", closeDialog);
        openCard("Version history", rows, info, h("div", { class: "zn-dialog-actions" }, clear, close));
      }
      function showHiddenTools() {
        const gone = [...hiddenTools()];
        showMenu(btnMore, [
          { label: "Hidden tools (their buttons and shortcuts stay off)", disabled: true },
          ...gone.map((id) => ({ label: HIDEABLE_TOOLS.find((x) => x[0] === id)?.[1] || id, action: needEdit(fmt[id] || (() => {})) })),
        ]);
      }
      const zenMode = () => cleanZenMode(getPref(PREF.ZEN_MODE, "off"));
      // Notes that link to this one, and notes that only mention its title.
      function showBacklinks() {
        const n = note();
        if (!n) return;
        const { linked, mentions } = findBacklinks(store.list(), n);
        const item = (t) => ({ icon: "note", label: titleOf(t.body) || "Untitled note", action: () => openNote(t.id, { focus: false }) });
        const items = [];
        if (linked.length) items.push({ label: "Linked from", disabled: true }, ...linked.map(item));
        if (mentions.length)
          items.push(
            { label: "Mentioned without a link (click = turn it into a link)", disabled: true },
            ...mentions.map((t) => ({
              icon: "link",
              label: titleOf(t.body) || "Untitled note",
              action: () => {
                const out = linkFirstMention(t.body, titleOf(n.body), n.id);
                if (out === null) return flash("No plain mention left to link");
                store.update(t.id, out);
                flash("Linked in " + (titleOf(t.body) || "that note"));
              },
            })),
          );
        if (!items.length) items.push({ label: "No other note links to this one", disabled: true });
        showMenu(btnMore, items);
      }
      // Image dialog: same layout as the link dialog. The address may come from the selection or the
      // clipboard; an optional second address makes the picture a link.
      function askImage() {
        if (note()?.trashed) return;
        if (mode === "read") setMode("edit");
        const [s, e] = sel();
        const selected = ta.value.slice(s, e);
        const selUrl = pastedWebAddress(selected);
        const alt = field("Description (alt text)", selUrl ? "" : selected.replace(/\s+/g, " ").trim(), "What the picture shows");
        const src = field("Picture address", selUrl || "", "https://");
        const link = field("Link when clicked (optional)", "", "https://");
        const help = h("p", {}, "Works with the web address (http:// or https://) of a picture: png, jpg, gif, webp or svg. Local files, data: addresses and pages behind a login do not load. In read view a picture loads only when you click it.");
        const ok = chip("Insert image", true);
        const cancel = chip("Cancel");
        openCard("Insert image", help, src.row, alt.row, link.row, h("div", { class: "zn-dialog-actions" }, cancel, ok));
        const submit = () => {
          let bad = null;
          if (!safeHref(src.input.value.trim(), false)) bad = src.input;
          else if (link.input.value.trim() && !safeHref(link.input.value.trim())) bad = link.input;
          if (bad) {
            bad.dataset.bad = "true";
            bad.focus();
            return;
          }
          closeDialog();
          applyEdit(insertImageMd(ta.value, s, e, alt.input.value.trim(), src.input.value.trim(), link.input.value.trim()));
        };
        ok.addEventListener("click", submit);
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        for (const f of [src, alt, link]) f.input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            submit();
          }
        });
        src.input.focus({ preventScroll: true });
        if (!selUrl) prefillFromClipboard(src.input, pastedWebAddress);
      }
      // Code block dialog: pick the language the block is highlighted as. A selection that already is
      // a fenced block is unwrapped at once instead.
      let lastCodeLang = "";
      function askCodeBlock() {
        if (note()?.trashed) return;
        if (mode === "read") setMode("edit");
        const [s, e] = sel();
        if (/^```[\w+#.-]*\n[\s\S]*?\n?```$/.test(ta.value.slice(s, e))) return applyEdit(insertCodeBlock(ta.value, s, e));
        // A list of buttons inside the sheet, not a native <select>: its popup is a separate window, so
        // clicking an option counts as a click outside the sheet and closes it.
        let chosen = lastCodeLang;
        const list = h("div", { class: "zn-quick zn-aligns", role: "listbox", "aria-label": "Highlight as" });
        const drawLangs = () => {
          list.replaceChildren();
          for (const [v, label] of CODE_LANGS) {
            const b = chip(label, v === chosen);
            b.setAttribute("aria-pressed", v === chosen ? "true" : "false");
            b.addEventListener("click", () => {
              chosen = v;
              drawLangs();
            });
            list.append(b);
          }
        };
        drawLangs();
        const ok = chip("Insert", true);
        const cancel = chip("Cancel");
        openCard("Code block: highlight as", list, h("div", { class: "zn-dialog-actions" }, cancel, ok));
        const go = () => {
          lastCodeLang = chosen;
          closeDialog();
          applyEdit(insertCodeBlock(ta.value, s, e, chosen));
        };
        ok.addEventListener("click", go);
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        ok.focus({ preventScroll: true });
      }
      // Table creator: pick a size on the grid (or type it), choose left / centre / right per column,
      // then insert a ready table.
      function askTable() {
        if (note()?.trashed) return;
        if (mode === "read") setMode("edit");
        const [s, e] = sel();
        const GRID_COLS = 8,
          GRID_ROWS = 6;
        const HINT = "Pick the size: columns \u00d7 rows (the first row is the header).";
        const label = h("p", {}, HINT);
        const grid = h("div", { class: "zn-grid" });
        const cells = [];
        const aligns = [];
        const alignBox = h("div", { class: "zn-quick zn-aligns" });
        const cols = field("Columns", "3");
        const rows = field("Rows", "3");
        const colCount = () => clampInt(cols.input.value, 1, MAX_TABLE_COLS);
        const drawAligns = () => {
          alignBox.replaceChildren();
          for (let i = 0; i < colCount(); i++) {
            const row = h("div", { class: "zn-quick-row" }, h("span", { class: "zn-quick-label" }, "Column " + (i + 1)));
            for (const [v, text] of [["left", "Left"], ["center", "Centre"], ["right", "Right"]]) {
              const b = chip(text, aligns[i] === v);
              b.setAttribute("aria-pressed", aligns[i] === v ? "true" : "false");
              b.addEventListener("click", () => {
                aligns[i] = aligns[i] === v ? "" : v;
                drawAligns();
              });
              row.append(b);
            }
            alignBox.append(row);
          }
        };
        const insert = () => {
          const n = colCount();
          closeDialog();
          applyEdit(insertTable(ta.value, s, e, clampInt(rows.input.value, 2, MAX_TABLE_ROWS), n, aligns.slice(0, n)));
        };
        const paint = (r, c) => {
          label.textContent = r && c ? `${c} \u00d7 ${r}` : HINT;
          for (const cell of cells) cell.el.classList.toggle("is-on", cell.r <= r && cell.c <= c);
        };
        for (let r = 1; r <= GRID_ROWS; r++)
          for (let c = 1; c <= GRID_COLS; c++) {
            const el = h("button", { type: "button", class: "zn-gcell", "aria-label": `${c} columns, ${r} rows` });
            el.addEventListener("mouseover", () => paint(r, c));
            el.addEventListener("focus", () => paint(r, c));
            el.addEventListener("click", () => {
              cols.input.value = String(c);
              rows.input.value = String(r);
              drawAligns();
            });
            cells.push({ el, r, c });
            grid.append(el);
          }
        grid.style.setProperty("--cols", String(GRID_COLS));
        grid.addEventListener("mouseleave", () => paint(0, 0));
        cols.input.addEventListener("input", drawAligns);
        for (const f of [cols, rows]) f.input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            insert();
          }
        });
        const ok = chip("Insert", true);
        const cancel = chip("Cancel");
        ok.addEventListener("click", insert);
        cancel.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        drawAligns();
        openCard("Insert table", label, grid, h("div", { class: "zn-field-pair" }, cols.row, rows.row), h("p", {}, "Text alignment per column (optional):"), alignBox, h("div", { class: "zn-dialog-actions" }, cancel, ok));
        cells[0].el.focus({ preventScroll: true });
      }
      // Toolbar and shortcut actions: hide the ones that are never used (each change is saved at once).
      function askTools() {
        const body = h("div", { class: "zn-quick zn-aligns" });
        const draw = () => {
          body.replaceChildren();
          const gone = hiddenTools();
          for (const [id, name] of HIDEABLE_TOOLS) {
            const shown = !gone.has(id);
            const b = chip(shown ? "Shown" : "Hidden", shown);
            b.setAttribute("aria-pressed", shown ? "true" : "false");
            b.addEventListener("click", () => {
              const g = hiddenTools();
              if (shown) g.add(id);
              else g.delete(id);
              setPref(PREF.HIDDEN_TOOLS, serializeHidden(g));
              applyState();
              draw();
            });
            body.append(h("div", { class: "zn-quick-row" }, h("span", { class: "zn-quick-label" }, name), b));
          }
        };
        draw();
        const all = chip("Show all");
        const done = chip("Done", true);
        all.addEventListener("click", () => {
          setPref(PREF.HIDDEN_TOOLS, "");
          applyState();
          draw();
        });
        done.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        openCard("Toolbar buttons and shortcuts", h("p", {}, "A hidden action has no button, no menu entry and no keyboard shortcut. Quick settings always stays."), body, h("div", { class: "zn-dialog-actions" }, all, done));
        done.focus({ preventScroll: true });
      }
      // Quick settings: the options that are changed while writing. Each change is saved at once.
      function askSettings() {
        const body = h("div", { class: "zn-quick" });
        const read = (o) => (o.meta ? store.meta[o.meta] : getPref(o.pref, o.def));
        const write = (o, v) => {
          if (o.meta) store.setMeta({ [o.meta]: v });
          else setPref(o.pref, v);
          if (o.meta) applyState();
          draw();
          fitCard();
        };
        function draw() {
          body.replaceChildren();
          for (const o of QUICK_OPTIONS) {
            const value = read(o);
            const row = h("div", { class: "zn-quick-row" }, h("span", { class: "zn-quick-label" }, o.label));
            if (o.kind === "bool") {
              const b = chip(value ? "On" : "Off", !!value);
              b.setAttribute("aria-pressed", value ? "true" : "false");
              b.addEventListener("click", () => write(o, !value));
              row.append(b);
            } else if (o.kind === "step") {
              const minus = iconButton("x", "Smaller");
              minus.replaceChildren(h("span", {}, "\u2212"));
              const plus = iconButton("plus", "Larger");
              minus.addEventListener("click", () => write(o, stepOption(o, value, -1)));
              plus.addEventListener("click", () => write(o, stepOption(o, value, 1)));
              row.append(minus, h("span", { class: "zn-quick-value" }, `${value}${o.unit}`), plus);
            } else {
              for (const [v, text] of o.choices) {
                const b = chip(text, value === v);
                b.addEventListener("click", () => write(o, v));
                row.append(b);
              }
            }
            body.append(row);
          }
        }
        draw();
        const more = chip("All settings\u2026");
        const done = chip("Done", true);
        more.addEventListener("click", () => askAllSettings());
        done.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        openCard("Quick settings", body, h("div", { class: "zn-dialog-actions" }, more, done));
        done.focus({ preventScroll: true });
      }
      // Settings: every option in one wide view with tabs (the Quick menu is the short list of what changes
      // while writing). Sliders and the colour picker are plain in-card inputs; "Theme" puts a value back to
      // what the theme says. Each change is saved at once.
      function askAllSettings(startTab = "writing") {
        let tabId = SETTINGS_TABS.some((t) => t.id === startTab) ? startTab : "writing";
        const tabs = h("div", { class: "zn-set-tabs", role: "tablist" });
        const body = h("div", { class: "zn-set-body" });
        const seedColor = (kind) => {
          try {
            const cs = window.getComputedStyle(root);
            const hex = kind === "bg" ? cssColorToHex(cs.backgroundColor) : kind === "text" ? cssColorToHex(cs.color) : null;
            return hex || (kind === "bg" ? "#1f1f24" : kind === "text" ? "#e9e9f0" : "#6aa7ff");
          } catch (_) {
            return "#6aa7ff";
          }
        };
        const readValue = (o) => (o.meta ? store.meta[o.meta] : getPref(o.pref, o.def));
        const writeValue = (o, v) => {
          if (o.meta) {
            store.setMeta({ [o.meta]: v });
            applyState();
          } else setPref(o.pref, v);
        };
        function sliderRow(o) {
          const stored = () => String(getPref(o.pref, o.plain ? o.def : -1));
          const has = () => (o.plain ? true : Number(stored()) >= o.min);
          const input = h("input", { type: "range", class: "zn-range", min: String(o.min), max: String(o.max), step: "1", "aria-label": o.label });
          const out = h("span", { class: "zn-quick-value" });
          const theme = chip(o.plain ? "Default" : "Theme", !has());
          const show = () => {
            input.value = has() ? stored() : String(o.seed);
            out.textContent = has() ? stored() + o.unit : "Theme";
            theme.classList.toggle("is-on", !has());
          };
          input.addEventListener("input", () => {
            setPref(o.pref, Number(input.value));
            show();
          });
          theme.addEventListener("click", () => {
            setPref(o.pref, o.plain ? o.def : -1);
            show();
          });
          show();
          return h("div", { class: "zn-set-row" }, h("span", { class: "zn-quick-label" }, o.label), input, out, theme);
        }
        function colorRow(o) {
          const stored = () => (LOOK_HEX.test(getPref(o.pref, "").trim()) ? getPref(o.pref, "").trim().toLowerCase() : "");
          const swatch = h("button", { type: "button", class: "zn-swatch", "aria-label": o.label, "aria-expanded": "false" });
          const theme = chip("Theme", !stored());
          const panel = h("div", { class: "zn-cpanel" });
          panel.hidden = true;
          const hsl = () => hexToHsl(stored() || seedColor(o.seed)) || { h: 210, s: 80, l: 60 };
          const mk = (label, max) => {
            const i = h("input", { type: "range", class: "zn-range", min: "0", max: String(max), step: "1", "aria-label": label });
            return i;
          };
          const sh = mk("Hue", 359), ss = mk("Saturation", 100), sl = mk("Lightness", 100);
          const hexIn = h("input", { type: "text", class: "zn-field zn-hex", spellcheck: "false", maxlength: "7", "aria-label": o.label + " hex", placeholder: "#rrggbb" });
          const paint = () => {
            const c = stored();
            swatch.style.background = c || "transparent";
            swatch.dataset.empty = c ? "false" : "true";
            theme.classList.toggle("is-on", !c);
            const v = hsl();
            sh.value = String(v.h);
            ss.value = String(v.s);
            sl.value = String(v.l);
            sh.style.background = "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";
            ss.style.background = `linear-gradient(90deg, ${hslToHex(v.h, 0, v.l)}, ${hslToHex(v.h, 100, v.l)})`;
            sl.style.background = `linear-gradient(90deg, #000, ${hslToHex(v.h, v.s, 50)}, #fff)`;
            if (document.activeElement !== hexIn) hexIn.value = c;
          };
          const fromSliders = () => {
            setPref(o.pref, hslToHex(sh.value, ss.value, sl.value));
            paint();
          };
          for (const i of [sh, ss, sl]) i.addEventListener("input", fromSliders);
          hexIn.addEventListener("input", () => {
            const t = hexIn.value.trim();
            const v = t.startsWith("#") ? t : "#" + t;
            const ok = LOOK_HEX.test(v);
            hexIn.dataset.bad = ok || !t ? "false" : "true";
            if (ok) {
              setPref(o.pref, v.toLowerCase());
              paint();
            }
          });
          swatch.addEventListener("click", () => {
            panel.hidden = !panel.hidden;
            swatch.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
          });
          theme.addEventListener("click", () => {
            setPref(o.pref, "");
            paint();
          });
          panel.append(h("label", { class: "zn-set-sub" }, h("span", {}, "Hue"), sh), h("label", { class: "zn-set-sub" }, h("span", {}, "Saturation"), ss), h("label", { class: "zn-set-sub" }, h("span", {}, "Lightness"), sl), hexIn);
          paint();
          return h("div", { class: "zn-set-item" }, h("div", { class: "zn-set-row" }, h("span", { class: "zn-quick-label" }, o.label), swatch, theme), panel);
        }
        function simpleRow(o) {
          const value = readValue(o);
          const row = h("div", { class: "zn-set-row" }, h("span", { class: "zn-quick-label" }, o.label));
          const redraw = () => {
            // Only the one row is drawn again, so a slider elsewhere is never rebuilt while it is dragged.
            row.replaceWith(simpleRow(o));
          };
          if (o.kind === "bool") {
            const b = chip(value ? "On" : "Off", !!value);
            b.setAttribute("aria-pressed", value ? "true" : "false");
            b.addEventListener("click", () => {
              writeValue(o, !value);
              redraw();
            });
            row.append(b);
          } else if (o.kind === "step") {
            const minus = iconButton("x", "Smaller");
            minus.replaceChildren(h("span", {}, "\u2212"));
            const plus = iconButton("plus", "Larger");
            minus.addEventListener("click", () => {
              writeValue(o, stepOption(o, value, -1));
              redraw();
            });
            plus.addEventListener("click", () => {
              writeValue(o, stepOption(o, value, 1));
              redraw();
            });
            row.append(minus, h("span", { class: "zn-quick-value" }, `${value}${o.unit}`), plus);
          } else if (o.kind === "text") {
            const input = h("input", { type: "text", class: "zn-field", spellcheck: "false", "aria-label": o.label });
            input.value = String(value ?? "");
            input.addEventListener("change", () => setPref(o.pref, input.value.trim()));
            row.append(input);
          } else {
            const group = h("div", { class: "zn-set-chips" });
            for (const [v, text] of o.choices) {
              const b = chip(text, value === v);
              b.addEventListener("click", () => {
                writeValue(o, v);
                redraw();
              });
              group.append(b);
            }
            row.append(group);
          }
          return row;
        }
        function drawTab() {
          const tab = SETTINGS_TABS.find((t) => t.id === tabId);
          tabs.replaceChildren(
            ...SETTINGS_TABS.map((t) => {
              const b = chip(t.label, t.id === tabId);
              b.setAttribute("role", "tab");
              b.setAttribute("aria-selected", t.id === tabId ? "true" : "false");
              b.addEventListener("click", () => {
                tabId = t.id;
                drawTab();
              });
              return b;
            }),
          );
          body.replaceChildren(
            ...tab.items.map((o) => (o.kind === "heading" ? h("strong", { class: "zn-set-heading" }, o.label) : o.kind === "slider" ? sliderRow(o) : o.kind === "color" ? colorRow(o) : simpleRow(o))),
          );
          body.scrollTop = 0;
        }
        drawTab();
        const reset = chip("Reset appearance");
        reset.addEventListener("click", () => {
          for (const k of LOOK_PREFS) setPref(k, LOOK_NUM_PREFS.has(k) ? -1 : k === PREF.LOOK_FONT ? "auto" : k === PREF.LOOK_EDITOR_FONT ? "same" : k === PREF.LOOK_BTN_STYLE ? "plain" : "");
          setPref(PREF.THEME, "zentral");
          drawTab();
        });
        const keys = chip("Keyboard shortcuts\u2026");
        const toolsChip = chip("Toolbar buttons\u2026");
        const done = chip("Done", true);
        keys.addEventListener("click", () => askShortcuts());
        toolsChip.addEventListener("click", () => askTools());
        done.addEventListener("click", () => {
          closeDialog();
          focusEditor();
        });
        const card = openCard("Settings", tabs, body, h("div", { class: "zn-dialog-actions" }, reset, toolsChip, keys, done));
        card.classList.add("zn-settings");
        done.focus({ preventScroll: true });
      }
      // Shortcut assignment: click a shortcut, press the new keys. Backspace clears, Esc cancels.
      function askShortcuts() {
        const body = h("div", { class: "zn-quick zn-keys" });
        const note2 = h("p", { class: "zn-key-note" }, "Click a shortcut, then press the new keys (Ctrl, Alt or Cmd is required). Backspace removes it.");
        let capturing = "";
        const overrides = () => parseShortcutMap(getPref(PREF.SHORTCUTS, ""));
        const rows = [...SHORTCUT_ACTIONS.map((a) => ({ id: a.id, label: a.label, def: a.def })), { id: "@global", label: "Open or close Notes (works anywhere)", def: "Alt+Shift+N" }];
        function current(id) {
          if (id === "@global") return normalizeCombo(getPref(PREF.SHORTCUT, "Alt+Shift+N"));
          return shortcutList().find((x) => x.id === id)?.combo || "";
        }
        function apply(id, combo) {
          if (id === "@global") {
            if (combo) setPref(PREF.SHORTCUT, combo);
            return;
          }
          setPref(PREF.SHORTCUTS, JSON.stringify(assignShortcut(overrides(), id, combo)));
        }
        function draw() {
          body.replaceChildren();
          for (const r of rows) {
            const btn = h("button", { type: "button", class: "zn-chip zn-keybtn" + (capturing === r.id ? " is-on" : "") }, capturing === r.id ? "Press keys\u2026" : current(r.id) || "none");
            btn.addEventListener("click", () => {
              capturing = capturing === r.id ? "" : r.id;
              note2.textContent = "Click a shortcut, then press the new keys (Ctrl, Alt or Cmd is required). Backspace removes it.";
              draw();
              if (capturing) btn.focus({ preventScroll: true });
            });
            btn.addEventListener("keydown", (ev) => {
              if (capturing !== r.id) return;
              ev.preventDefault();
              ev.stopPropagation();
              if (ev.key === "Escape") capturing = "";
              else if (ev.key === "Backspace" || ev.key === "Delete") {
                if (r.id !== "@global") apply(r.id, "");
                capturing = "";
              } else {
                const combo = comboFromEvent(ev);
                if (!combo) return; // a lone modifier: wait for the real key
                if (!parseShortcut(combo)) {
                  note2.textContent = "That needs Ctrl, Alt or Cmd as well.";
                  return;
                }
                const taken = r.id === "@global" ? "" : findShortcutConflict(shortcutList(), r.id, combo);
                const globalCombo = normalizeCombo(getPref(PREF.SHORTCUT, "Alt+Shift+N"));
                if (taken || (r.id !== "@global" && combo === globalCombo)) {
                  note2.textContent = `${combo} is already used by ${taken ? SHORTCUT_ACTIONS.find((a) => a.id === taken).label : "the open/close shortcut"}.`;
                  return;
                }
                apply(r.id, combo);
                capturing = "";
              }
              draw();
              applyState();
            });
            const reset = h("button", { type: "button", class: "zn-chip", title: "Back to the default" }, "Reset");
            reset.hidden = r.id === "@global" ? current(r.id) === r.def : current(r.id) === r.def;
            reset.addEventListener("click", () => {
              apply(r.id, r.def);
              draw();
              applyState();
            });
            body.append(h("div", { class: "zn-quick-row" }, h("span", { class: "zn-quick-label" }, r.label), btn, reset));
          }
        }
        draw();
        const all = chip("Reset all");
        const back = chip("Back", true);
        all.addEventListener("click", () => {
          setPref(PREF.SHORTCUTS, "");
          setPref(PREF.SHORTCUT, "Alt+Shift+N");
          capturing = "";
          draw();
          applyState();
        });
        back.addEventListener("click", () => askSettings());
        openCard("Keyboard shortcuts", note2, body, h("div", { class: "zn-dialog-actions" }, all, back));
      }
      const moreItems = () => {
        const n = note();
        if (!n) return [];
        const items = [
          { icon: "save", label: "Import & export", group: [
            { icon: "save", label: "Save as Markdown\u2026", action: () => env.exportNote(n, "md") },
            { icon: "save", label: "Export as HTML\u2026", action: () => askExport("html", () => env.exportNote(n, "html")) },
            { icon: "save", label: "Export as plain text\u2026", action: () => askExport("txt", () => env.exportNote(n, "txt")) },
            { icon: "save", label: "Print / save as PDF\u2026", action: () => askExport("pdf", () => env.printNote(n)) },
            { sep: true },
            { icon: "save", label: "Export all notes\u2026", action: () => env.exportAll(store.list()) },
            { icon: "save", label: "Export all as zip\u2026", action: () => askExport("zip", async () => { const k = await env.exportZip(store.list()); if (k) flash(`Zipped ${k} notes`); }) },
            { icon: "folder", label: "Import .md folder\u2026", action: async () => { const k = await env.importFolder(store); flash(k ? `Imported ${k} notes` : "Nothing imported"); if (view === "list") scheduleList(); } },
          ] },
          { icon: "copy", label: "Copy text", action: () => env.copyText(n.body) },
          ...(n.trashed ? [] : [{ icon: "bookmark", label: n.label ? "Edit label\u2026" : "Add label\u2026", action: () => askLabel() }]),
          { icon: "bookmark", label: "Labels\u2026", action: () => queueMicrotask(askLabels) },
          { icon: "link", label: "Check links\u2026", action: () => queueMicrotask(askLinkCheck) },
          { icon: "note", label: "Install demo notes", action: () => installDemoNotes() },
          { icon: "note", label: "New from template\u2026", action: () => queueMicrotask(() => showTemplateMenu(btnMore)) },
          ...(n.trashed ? [] : [{ icon: "duplicate", label: "Save as template", action: () => saveAsTemplate() }]),
          ...(n.trashed ? [] : [{ icon: "bell", label: n.remind ? "Reminder: " + reminderText(n.remind) + "\u2026" : "Remind me\u2026", action: () => askReminder() }]),
          ...(n.trashed ? [] : [{ icon: "search", label: "Find in notes (Ctrl+F)", action: () => openFind() }]),
          { icon: "link", label: "Notes that link here\u2026", action: () => queueMicrotask(showBacklinks) },
          { icon: "bell", label: "Notes by date\u2026", action: () => queueMicrotask(showDateMenu) },
          ...(n.trashed ? [] : [{ icon: "note", label: "Outline\u2026", action: () => queueMicrotask(showOutline) }]),
          ...(n.trashed ? [] : [{ icon: "restore", label: "Version history\u2026", action: () => askHistory() }]),
          ...(getPref(PREF.HIDDEN_MENU, true) && hiddenTools().size && !n.trashed ? [{ icon: "sliders", label: "Hidden tools\u2026", action: () => queueMicrotask(showHiddenTools) }] : []),
          ...(zenMode() === "selected" && !n.trashed
            ? [cleanFolder(n.folder) === TABBAR_FOLDER || cleanFolder(n.folder).startsWith(TABBAR_FOLDER + "/")
                ? { icon: "folder", label: "Remove from Notes (tabbar)", action: () => { store.setFolder(n.id, ""); applyState(); flash("Moved out of the Zen sidebar folder"); } }
                : { icon: "folder", label: "Move to Notes (tabbar)", action: () => { store.ensureTabbarFolder(); store.setFolder(n.id, TABBAR_FOLDER); applyState(); flash("Shown in the Zen sidebar folder"); } }]
            : []),
          { icon: "plus", label: "New note", action: () => newNote() },
          ...(adapter.geoKey || adapter.pushPanel ? [{ icon: "maximize", label: store.meta.size === "span" ? "Back to normal size" : "Fill the whole area", action: () => toggleSpan() }] : []),
          { icon: "duplicate", label: "Duplicate", action: () => { const c = store.create(n.body); store.setColor(c.id, n.color); store.setLabel(c.id, n.label); openNote(c.id); } },
          { sep: true },
          { icon: "folder", label: "Open notes folder", action: () => env.revealFolder(store.dir) },
          { icon: "folder", label: "Move to folder\u2026", action: () => askNoteFolder() },
          { icon: "sliders", label: "Quick settings\u2026", action: () => askSettings() },
          { icon: "sliders", label: "All settings\u2026", action: () => askAllSettings() },
          ...(adapter.geoKey ? [{ icon: "restore", label: "Reset position and size", action: () => resetGeo() }] : []),
          { sep: true },
        ];
        if (n.trashed) {
          items.push({ icon: "restore", label: "Restore", action: () => { store.restore(n.id); applyState(); } });
          items.push({ icon: "trash", label: "Delete forever", danger: true, action: () => { const id = n.id; currentId = ""; store.deleteForever(id).then(showEditor); } });
        } else
          items.push({ icon: "trash", label: "Move to trash", danger: true, action: () => { const id = n.id; store.trash(id); currentId = ""; showEditor(); } });
        return items;
      };
      listen(btnMore, "click", () => showMenu(btnMore, moreItems()));
      listen(btnColor, "click", () => {
        const n = note();
        if (n && !n.trashed)
          showMenu(btnColor, [{ swatches: NOTE_COLORS, current: n.color, pick: (c) => { store.setColor(n.id, c); applyState(); } }]);
      });
      listen(tHlMenu, "mousedown", (e) => e.preventDefault());
      listen(tHlMenu, "click", () =>
        showMenu(tHlMenu, [{ swatches: HIGHLIGHT_COLORS, current: store.meta.highlight, pick: (c) => { store.setMeta({ highlight: c }); applyState(); needEdit(fmt.highlight)(); } }]),
      );

      // ---- events ----------------------------------------------------------------
      listen(btnClose, "click", () => close());
      listen(btnList, "click", () => (view === "list" ? showEditor() : showList()));
      listen(titleEl, "click", () => (view === "list" ? showEditor() : showList()));
      listen(btnPin, "click", () => {
        const n = note();
        if (n && !n.trashed) {
          store.setPinned(n.id, !n.pinned);
          applyState();
        }
      });
      // ---- size, window pin, geometry -------------------------------------------------------------
      const setSize = (size) => {
        store.setMeta({ size });
        applyState();
        if (adapter.pushPanel && isOpen && !collapsed) applyPush(0, 0);
        layout();
      };
      const toggleLarger = () => setSize(store.meta.size === "peek" ? "full" : "peek");
      const toggleSpan = () => setSize(store.meta.size === "span" ? "peek" : "span");
      const dockMode = () => (adapter.pushPanel ? cleanDockMode(store.meta.dock, getPref(PREF.HOVER_REVEAL, false) ? "hover" : "dock") : "pin");
      function setDock(next) {
        const m = cleanDockMode(next);
        store.setMeta({ dock: m, pinned: m !== "hover" });
        if (m !== "hover") {
          window.clearTimeout(graceTimer);
          graceTimer = 0;
          if (collapsed) expand(false);
        }
        applyState();
        scheduleLayout();
        if (isOpen && !collapsed) applyPush(0, 0);
        if (m === "hover") armGrace();
      }
      const toggleKeep = () => {
        if (adapter.pushPanel) return setDock(dockMode() === "pin" ? "dock" : "pin");
        store.setMeta({ pinned: store.meta.pinned === false });
        applyState();
      };
      function resetGeo() {
        const key = adapter.geoKey;
        if (!key) return;
        if (adapter.pushPanel) {
          // A slot sheet has no box to reset: it goes back to the preferred height.
          store.setMeta({ shareDock: 0, shareGap: 0, size: "peek" });
          applyState();
          if (isOpen && !collapsed) applyPush(0, 0);
          layout();
          flash("Height reset", 2500);
          return;
        }
        const g = { ...(store.meta.geo || {}) };
        delete g[key];
        store.setMeta({ geo: g, size: "peek" });
        applyState();
        layout();
        flash("Position and size reset", 2500);
      }
      // A button with a second action on a long press: the timer exists only between press and release.
      function holdButton(btn, onTap, onHold) {
        const hold = createHoldAction({
          setTimer: (fn, ms) => window.setTimeout(fn, ms),
          clearTimer: (id) => window.clearTimeout(id),
          onTap,
          onHold,
        });
        listen(btn, "pointerdown", (e) => {
          if (e.button === undefined || e.button === 0) hold.press();
        });
        listen(btn, "pointerup", () => hold.release());
        listen(btn, "pointerleave", () => hold.cancel());
        listen(btn, "click", () => hold.click());
        cleanups.push(() => hold.cancel());
        return hold;
      }
      holdButton(btnSize, toggleLarger, toggleSpan);
      holdButton(btnKeep, toggleKeep, resetGeo);
      listen(btnHover, "click", () => setDock(dockMode() === "hover" ? "dock" : "hover"));
      listen(btnDock, "click", () => setDock("dock"));

      // Drag the title bar, resize from any edge or corner. The area is measured once when the gesture
      // starts; pointer events only remember the latest position and one frame paints it. The result is
      // stored (per host: panel / standalone card) when the pointer is released.
      let gesture = null;
      let rafDrag = 0;
      let swallowClick = false;
      let emptyTimer = 0; // "Empty trash" confirm window (3 s); cleared on destroy
      cleanups.push(() => window.clearTimeout(emptyTimer));
      function hostOffset() {
        if (adapter.position !== "absolute") return { ox: 0, oy: 0 };
        const op = root.offsetParent;
        if (!op) return null;
        const r = op.getBoundingClientRect();
        return { ox: r.left + (op.clientLeft || 0), oy: r.top + (op.clientTop || 0) };
      }
      // A slot sheet (docked band / gap between the panels) is not a free box: the title bar and its top edge
      // (also its bottom edge in a gap) resize the band, nothing else moves.
      function startSlotGesture(e, kind, slot) {
        const edge = kind === "move" ? "n" : kind.includes("n") ? "n" : kind.includes("s") && slot === "gap" ? "s" : "";
        const info = adapter.slotInfo?.();
        if (!edge || !info) return;
        gesture = { slot, kind, edge, id: e.pointerId, sy: e.clientY, startPx: info.px, startUp: info.up || 0, startDown: info.down || 0, roomUp: info.roomUp, roomDown: info.roomDown, base: info.base, active: kind !== "move", next: null, share: 0, px: 0, up: -1 };
        try {
          e.currentTarget?.setPointerCapture?.(e.pointerId);
        } catch (_) {}
        if (kind !== "move") {
          root.dataset.dragging = "true";
          e.preventDefault();
          e.stopPropagation();
        }
      }
      function startGesture(e, kind) {
        if (e.button !== undefined && e.button !== 0) return;
        const slot = adapter.slotKind?.() || "";
        if (slot) return startSlotGesture(e, kind, slot);
        if (!adapter.geoKey) return;
        const a = adapter.getArea({});
        const off = hostOffset();
        if (!a || !off) return;
        const b = a.bounds || a;
        const r = root.getBoundingClientRect();
        gesture = {
          kind,
          key: adapter.geoKey,
          id: e.pointerId,
          sx: e.clientX,
          sy: e.clientY,
          start: { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height },
          area: { w: b.width, h: b.height },
          ox: b.left - off.ox,
          oy: b.top - off.oy,
          active: kind !== "move",
          next: null,
          rect: null,
        };
        try {
          e.currentTarget?.setPointerCapture?.(e.pointerId);
        } catch (_) {}
        if (kind !== "move") {
          root.dataset.dragging = "true";
          e.preventDefault();
          e.stopPropagation();
        }
      }
      function paintGesture() {
        rafDrag = 0;
        const g = gesture;
        if (!g || !g.next) return;
        const { dx, dy } = g.next;
        if (g.slot) {
          // The band follows the pointer: new height -> reserve -> the panels give or take the room.
          if (g.slot === "gap") {
            // Between the web panels each edge moves ITS panel's boundary only; the other edge does not follow.
            const r = gapEdgeDrag({ edge: g.edge, startUp: g.startUp, startDown: g.startDown, dy, base: g.base, roomUp: g.roomUp, roomDown: g.roomDown });
            g.px = r.px;
            g.up = r.up;
            g.share = r.px > 0 && g.base > 200 ? r.px / g.base : 0;
            if (g.share > 0) {
              adapter.pushPanel(0, { px: r.px, up: r.up });
              layout();
            }
            return;
          }
          g.share = slotDragShare({ startPx: g.startPx, base: g.base, dy, dir: g.edge === "n" ? -1 : 1 });
          if (g.share > 0) {
            adapter.pushPanel(g.share);
            layout();
          }
          return;
        }
        const rect = g.kind === "move" ? moveGeo(g.start, dx, dy, g.area) : resizeGeo(g.start, g.kind, dx, dy, g.area);
        g.rect = rect;
        root.style.left = Math.round(g.ox + rect.x) + "px";
        root.style.top = Math.round(g.oy + rect.y) + "px";
        root.style.width = rect.w + "px";
        root.style.height = rect.h + "px";
        const split = rect.w >= 560 ? "side" : "stack";
        if (root.dataset.split !== split) root.dataset.split = split;
      }
      function moveEvent(e) {
        const g = gesture;
        if (!g || (e.pointerId !== undefined && g.id !== undefined && e.pointerId !== g.id)) return;
        const dx = e.clientX - (g.sx ?? e.clientX),
          dy = e.clientY - g.sy;
        if (!g.active) {
          if (Math.hypot(dx, dy) < DRAG_SLOP) return;
          g.active = true;
          root.dataset.dragging = "true";
          closeMenu();
        }
        g.next = { dx, dy };
        if (!rafDrag) rafDrag = window.requestAnimationFrame(paintGesture);
      }
      // Drop a gesture without applying it (the sheet closes, the panel is replaced or torn down): no stale
      // pointer state, pending frame or half-applied reserve survives.
      function cancelGesture() {
        gesture = null;
        if (rafDrag) window.cancelAnimationFrame(rafDrag);
        rafDrag = 0;
        delete root.dataset.dragging;
      }
      function endGesture() {
        const g = gesture;
        if (!g) return;
        gesture = null;
        if (rafDrag) window.cancelAnimationFrame(rafDrag);
        rafDrag = 0;
        delete root.dataset.dragging;
        if (!g.active || !g.next) return;
        if (g.kind === "move") swallowClick = true;
        gesture = g;
        paintGesture(); // flush the last position
        gesture = null;
        taAnchY = null;
        readAnchY = null;
        if (g.slot) {
          if (g.share > 0) {
            // Remembered per kind of slot, as a share of the pages (so it survives a window resize).
            const patch = { [g.slot === "gap" ? "shareGap" : "shareDock"]: Math.round(g.share * 1000) / 1000, size: "peek" };
            if (g.slot === "gap" && g.px > 0) patch.gapSplit = Math.round((g.up / g.px) * 1000) / 1000;
            store.setMeta(patch);
            applyState();
            layout();
          }
          return;
        }
        if (g.rect) {
          store.setMeta({ geo: { ...(store.meta.geo || {}), [g.key]: g.rect }, size: "peek" });
          applyState();
        }
      }
      listen(head, "pointerdown", (e) => {
        const btn = e.target?.closest?.("button");
        if (btn && !btn.classList.contains("zn-title")) return;
        startGesture(e, "move");
      });
      for (const grip of root.querySelectorAll(".zn-rz"))
        listen(grip, "pointerdown", (e) => startGesture(e, grip.getAttribute("data-h")));
      listen(root, "pointermove", moveEvent);
      listen(root, "pointerup", endGesture);
      listen(root, "pointercancel", endGesture);
      listen(head, "click", (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.stopPropagation();
        e.preventDefault();
      }, true);
      listen(head, "dblclick", (e) => {
        const btn = e.target?.closest?.("button");
        if (!btn || btn.classList.contains("zn-title")) resetGeo();
      });
      cleanups.push(() => {
        if (rafDrag) window.cancelAnimationFrame(rafDrag);
      });
      // Cycle F #7: with pref new_note_chooser the + button asks first (Blank is focused, so Enter = blank note).
      // Ctrl+N and the menu entries stay instant. Esc only closes the menu.
      function newNoteChooser() {
        if (!getPref(PREF.NEW_CHOOSER, false)) return newNote();
        const now = Date.now();
        const day = (k, label) => ({ icon: "bell", label: label + "  " + dateTarget(k, now).ymd, action: () => openDateNote(k) });
        showMenu(btnNew, [
          { icon: "plus", label: "Blank note", action: () => newNote() },
          day("today", "Today"),
          day("tomorrow", "Tomorrow"),
          { icon: "bell", label: "Pick date\u2026", action: () => queueMicrotask(askOtherDate) },
          { icon: "note", label: "From template\u2026", group: templateMenuItems() },
        ]);
      }
      listen(btnNew, "click", () => newNoteChooser());
      listen(btnFolder, "click", () => askFolderName("New folder", "", (name) => store.addFolder(name, "")));
      // A note dropped on empty list space goes back to the top level.
      listen(listItems, "dragover", (e) => {
        if (dragNoteId && treeMode()) e.preventDefault();
      });
      listen(listItems, "drop", (e) => {
        if (!dragNoteId || !treeMode()) return;
        e.preventDefault();
        const id = dragNoteId;
        dragNoteId = "";
        if (store.get(id)) store.setFolder(id, "");
      });
      listen(chipAll, "click", () => { filter = "all"; renderList(); });
      listen(chipRecent, "click", () => { filter = "recent"; renderList(); });
      listen(chipTrash, "click", () => { filter = "trash"; renderList(); });
      for (const c of [chipTrash, chipEmpty]) listen(c, "contextmenu", (e) => { e.preventDefault(); showMenu(pointAnchor(e), trashMenuItems()); });
      listen(chipEmpty, "click", () => {
        if (chipEmpty.dataset.armed) {
          delete chipEmpty.dataset.armed;
          chipEmpty.textContent = "Empty trash";
          store.emptyTrash().then(scheduleList);
        } else {
          chipEmpty.dataset.armed = "true";
          chipEmpty.textContent = "Click again to confirm";
          window.clearTimeout(emptyTimer);
          emptyTimer = window.setTimeout(() => {
            emptyTimer = 0;
            delete chipEmpty.dataset.armed;
            chipEmpty.textContent = "Empty trash";
          }, 3000);
        }
      });
      listen(search, "input", () => { query = search.value; scheduleList(); });
      listen(search, "keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          const first = listItems.querySelector(".zn-item");
          if (first) {
            e.preventDefault();
            if (e.key === "Enter") first.click();
            else first.focus();
          }
        }
      });
      let wikiState = null;
      function hideWiki() {
        wikiState = null;
        wikiBar.hidden = true;
        wikiBar.replaceChildren();
      }
      function paintWiki() {
        wikiBar.replaceChildren();
        wikiState.hits.forEach((t, i) => {
          const b = h("button", { type: "button", class: "zn-wiki-item" + (i === wikiState.idx ? " is-on" : ""), role: "option" }, titleOf(t.body) || "Untitled note");
          b.addEventListener("mousedown", (ev) => ev.preventDefault()); // keep the caret in the editor
          b.addEventListener("click", () => pickWiki(i));
          wikiBar.append(b);
        });
        wikiBar.hidden = false;
      }
      function updateWiki() {
        if (!getPref(PREF.WIKI_COMPLETE, true) || mode === "read" || ta.readOnly || ta.selectionStart !== ta.selectionEnd) return hideWiki();
        const trig = wikiTrigger(ta.value, ta.selectionStart);
        if (!trig) return hideWiki();
        const hits = store.list({ query: trig.query.trim() }).filter((x) => x.id !== currentId).slice(0, 6);
        if (!hits.length) return hideWiki();
        wikiState = { trig, hits, idx: 0 };
        paintWiki();
      }
      function pickWiki(i) {
        const st = wikiState;
        if (!st || !st.hits[i]) return;
        hideWiki();
        applyEdit(wikiComplete(ta.value, st.trig, ta.selectionStart, titleOf(st.hits[i].body) || "Untitled note"));
      }
      listen(ta, "keydown", (e) => {
        if (!wikiState || e.isComposing) return;
        const n = wikiState.hits.length;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") wikiState.idx = (wikiState.idx + (e.key === "ArrowDown" ? 1 : n - 1)) % n, paintWiki();
        else if (e.key === "Enter" || e.key === "Tab") pickWiki(wikiState.idx);
        else if (e.key === "Escape") hideWiki();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }, true);
      listen(ta, "keyup", (e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) updateWiki();
        if (e.shiftKey || e.key === "Shift") scheduleChrome();
      });
      listen(ta, "mouseup", () => { if (getPref(PREF.FOOTER_COUNTER, false) === true) scheduleChrome(); });
      listen(ta, "input", () => {
        updateWiki();
        taAnchY = null;
        readAnchY = null;
        typed = true;
        store.update(currentId, ta.value, token);
        scheduleChrome();
        scheduleFindRefresh();
        if (mode === "split") schedulePreview();
      });
      // Pasting one web address: offer the "create link" dialog (text to show + address).
      listen(ta, "paste", (e) => {
        if (!ta.readOnly) {
          const picture = clipboardPicture(e.clipboardData);
          if (picture) {
            e.preventDefault();
            pastePictureFile(picture).catch((error) => console.warn("[ZentralNotes] picture paste failed", error));
            return;
          }
        }
        const how = getPref(PREF.PASTE_LINK, "ask");
        if (how === "off" || ta.readOnly) return;
        const text = e.clipboardData?.getData?.("text/plain") ?? "";
        const link = pastedLink(text);
        if (!link) return;
        const [s, en] = sel();
        if (how === "selection" && s === en) return;
        e.preventDefault();
        askLink({ pasted: text.trim(), s, e: en });
      });
      listen(ta, "blur", () => {
        hideWiki();
        const n = note();
        if (!typed && n && n.body !== ta.value) ta.value = n.body;
        store.flush();
      });
      listen(root, "mousedown", (e) => e.stopPropagation());
      listen(root, "keydown", (e) => {
        try {
          handleKey(e);
        } catch (error) {
          console.warn("[ZentralNotes] key handler failed", error);
        }
        e.stopPropagation();
      });

      const ACTIONS = {
        ...Object.fromEntries(["bold", "italic", "strike", "highlight", "code", "codeBlock", "link", "noteLink", "image", "heading", "bullet", "numbered", "check", "quote", "table", "rule", "indent", "outdent", "sup", "sub", "kbd", "footnote", "hubList", ...CALLOUT_KINDS.map(([k]) => calloutId(k))].map((id) => [id, () => fmt[id]()])),
        newNote: () => newNote(),
        outline: () => showOutline(),
        find: () => openFind(),
        remind: () => askReminder(),
        dateToday: () => openDateNote("today"),
        dateTomorrow: () => openDateNote("tomorrow"),
        dateNext: () => openDateNote("next"),
        dateList: () => showDateMenu(),
        history: () => askHistory(),
        pastePicture: () => pastePictureFromClipboard(),
        pictureOptions: () => askPictureOptions(),
        list: () => showList(),
        mode: () => {
          if (view === "editor") setMode(mode === "read" ? "edit" : "read");
        },
        split: () => {
          if (view === "editor") setMode(mode === "split" ? "edit" : "split");
        },
        settings: () => askSettings(),
        recent: () => {
          filter = "recent";
          showList();
        },
        notePin: () => btnPin.click(),
        keepOpen: () => toggleKeep(),
        larger: () => toggleLarger(),
        span: () => toggleSpan(),
        resetGeo: () => resetGeo(),
      };
      function handleKey(e) {
        if (e.isComposing) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (key === "Escape") {
          if (dialog) closeDialog();
          else if (menu) closeMenu();
          else if (findOpen) closeFind();
          else if (view === "list") showEditor();
          else close();
          e.preventDefault();
          return;
        }
        if (mod || e.altKey) {
          const id = matchShortcutAction(e, shortcutList());
          if (id) {
            const act = ACTIONS[id];
            const def = SHORTCUT_ACTIONS.find((a) => a.id === id);
            const editing = view === "editor" && mode !== "read" && e.target === ta;
            if (act && (!def.edit || editing)) {
              act();
              e.preventDefault();
              return;
            }
          }
        }
        if (view === "editor" && mode !== "read" && e.target === ta && key === "Enter" && !e.shiftKey && !mod && !e.altKey && ta.selectionStart === ta.selectionEnd && !ta.readOnly) {
          const edit = continueList(ta.value, ta.selectionStart);
          if (edit) {
            applyEdit(edit);
            e.preventDefault();
          }
        }
      }

      const offStore = store.on((ev) => {
        if (!isOpen || destroyed) return;
        if (findOpen && ev.type !== "status") scheduleFindRefresh();
        if (ev.type === "status") return scheduleChrome();
        if (ev.type === "reset") {
          if (currentId && !store.get(currentId)) currentId = "";
          if (view === "editor") showEditor();
          else scheduleList();
          return;
        }
        if ((ev.type === "remove" || ev.type === "tree" || (ev.type === "change" && ev.id !== currentId)) && view === "editor" && mode !== "edit" && readEl.querySelector?.(".zn-notelink")) refreshRead();
        if (ev.type === "tree") return view === "list" ? scheduleList() : undefined;
        if (ev.type === "remove") {
          if (ev.id === currentId) {
            currentId = "";
            if (view === "editor") showEditor();
          }
          return view === "list" ? scheduleList() : undefined;
        }
        if (ev.type === "change") {
          if (ev.id === currentId && ev.source !== token) {
            const n = note();
            if (n && document.activeElement !== ta && ta.value !== n.body) {
              const st = ta.scrollTop;
              ta.value = n.body;
              ta.scrollTop = st;
            }
            if (mode !== "edit" && view === "editor") renderRead();
            applyState();
            scheduleChrome();
          }
          if (view === "list") scheduleList();
        }
      });

      // ---- layout ------------------------------------------------------------------
      function layout() {
        rafLayout = 0;
        if (!isOpen || destroyed || root.hidden) return;
        if (collapsed) {
          placeReveal();
          return;
        }
        // A panel-hosted sheet settles its slot BEFORE the area is measured (the reserve is applied synchronously),
        // so a stale size / box can never be laid out for one frame in the wrong place.
        if (adapter.pushPanel) applyPush(0, 0);
        // A panel stretched top-to-bottom has no room for the band: the sheet stays hidden and takes no clicks
        // (no invisible hit area) until the panel is shortened again.
        if (adapter.suspended?.()) {
          if (gesture) cancelGesture();
          root.dataset.suspended = "true";
          root.style.visibility = "hidden";
          root.style.pointerEvents = "none";
          root.dataset.slot = "";
          return;
        }
        if (root.dataset.suspended) {
          delete root.dataset.suspended;
          root.style.visibility = "";
          root.style.pointerEvents = "";
        }
        const a = adapter.getArea({ wide: mode === "split", span: store.meta.size === "span" });
        if (!a || a.width < 40 || a.height < 40) return;
        const size = a.fill ? "full" : store.meta.size;
        const off = hostOffset();
        if (!off) return;
        const key = adapter.geoKey || "";
        const b = a.bounds || a;
        const geo = key ? store.meta.geo?.[key] : null;
        let left, top, w, hgt;
        if (geo && size === "peek" && b.height >= 320 && !a.wideFill) {
          const g = clampGeo(geo, { w: b.width, h: b.height });
          left = b.left + g.x;
          top = b.top + g.y;
          w = g.w;
          hgt = g.h;
          // Split view: the remembered box grows toward the middle of the window (the side with room).
          if (mode === "split") {
            const wideW = Math.min(Math.round(g.w * widePct()), Math.max(g.w, b.width - 8));
            if (left + g.w / 2 > b.left + b.width / 2) left = Math.max(b.left + 4, left - (wideW - g.w));
            else left = Math.min(left, b.left + b.width - wideW - 4);
            w = wideW;
          }
        } else {
          const r = placeSheet({ area: a, size });
          left = a.left + r.x;
          top = a.top + r.y;
          w = r.w;
          hgt = r.h;
        }
        root.style.left = Math.round(left - off.ox) + "px";
        root.style.top = Math.round(top - off.oy) + "px";
        root.style.width = Math.round(w) + "px";
        root.style.height = Math.round(hgt) + "px";
        root.dataset.split = w >= 560 ? "side" : "stack";
        taAnchY = null;
        readAnchY = null;
        adapter.setSpill?.(!!a.wideFill || !!a.outside);
        root.dataset.slot = adapter.slotKind?.() || "";
        placeReveal();
        applyPush(left, w);
      }
      // ---- push page (standalone card): the page makes room instead of being covered ---------------
      const widePct = () => Math.max(1.3, Math.min(3, getPref(PREF.WIDE_PERCENT, 200) / 100));
      let pushed = false;
      function applyPush(left, w) {
        // Slot model (V4-R1/R4): a panel-hosted sheet is a layout slot (normal panel = page + Notes,
        // Triple View = quad, bottom bar of Triple View = the gap between the two panels). Pin mode is the
        // plain overlay (no push); a collapsed hover sheet keeps only its thin real strip in layout.
        // The push_page pref + peek gate govern the standalone card.
        const panelHosted = !!adapter.pushPanel;
        const between = panelHosted && adapter.placement?.() === "between";
        const on = panelHosted ? dockMode() !== "pin" || between : !!getPref(PREF.PUSH_PAGE, false) && store.meta.size === "peek";
        const want = !!adapter.push && on;
        if (want) pushed = adapter.push({ left, width: w }) || false;
        else if (pushed || adapter.push) {
          adapter.unpush?.();
          pushed = false;
        }
        if (panelHosted) {
          const strip = isOpen && collapsed ? hoverStripPx(getPref(PREF.REVEAL_HEIGHT, 10)) : 0;
          // While the edge is being dragged the live share wins over the remembered one.
          const dragShare = gesture && gesture.slot && gesture.active && gesture.share > 0 ? gesture.share : 0;
          const share =
            on && !collapsed && isOpen
              ? dragShare || slotShare({ size: store.meta.size, pref: getPref(PREF.PUSH_PANEL_PERCENT, 45), custom: between ? store.meta.shareGap : store.meta.shareDock })
              : 0;
          const gdrag = between && isOpen && !collapsed && gesture && gesture.slot === "gap" && gesture.active && gesture.px > 0 ? gesture : null;
          const quad = adapter.pushPanel(gdrag ? 0 : share, gdrag ? { strip, px: gdrag.px, up: gdrag.up } : { strip, upFrac: between ? store.meta.gapSplit : -1 });
          root.dataset.slot = adapter.slotKind?.() || "";
          if (quad) root.dataset.bgalazkaTripleSlot = "notes";
          else delete root.dataset.bgalazkaTripleSlot;
        }
      }
      // ---- hover mode (V4-R2, replaces tuck) --------------------------------------------------------
      // Collapsed = the sheet is hidden and a 4-6 px strip is a REAL band of the layout (the panel gave up
      // that height), positioned from the live band every time, never from a copy of the sheet's geometry.
      // Opening waits an open delay; folding away waits a grace of at least 600 ms and never happens while
      // focus is inside, a menu or dialog is open, a drag runs or the pointer is down.
      const hoverMode = () => !!adapter.pushPanel && dockMode() === "hover";
      const timing = () => hoverTiming({ open: getPref(PREF.REVEAL_DELAY, 100), grace: HOVER_CLOSE_GRACE_MS });
      function placeReveal() {
        if (!revealEl) return;
        const band = adapter.bandRect?.();
        const off = hostOffset();
        if (!band || !off) return;
        revealEl.style.position = adapter.position;
        revealEl.style.left = Math.round(band.left - off.ox) + "px";
        revealEl.style.top = Math.round(band.top - off.oy) + "px";
        revealEl.style.width = Math.round(band.width) + "px";
        revealEl.style.height = Math.round(band.height) + "px";
      }
      function armGrace() {
        window.clearTimeout(graceTimer);
        graceTimer = 0;
        if (!hoverMode() || !isOpen || collapsed || destroyed || ptrInside) return;
        graceTimer = window.setTimeout(() => {
          graceTimer = 0;
          if (!hoverMode() || !isOpen || collapsed || destroyed || ptrInside) return;
          const may = hoverMayClose({ focusInside: focusInside(), menuOpen: !!menu, dialogOpen: !!dialog, pointerDown: ptrDown, gesture: !!gesture, pointerInside: ptrInside });
          if (may) collapse();
          else armGrace();
        }, timing().graceMs);
      }
      function collapse() {
        if (collapsed || !isOpen || destroyed || !hoverMode()) return;
        collapsed = true;
        window.clearTimeout(graceTimer);
        graceTimer = 0;
        closeMenu();
        closeDialog();
        drop();
        try {
          if (root.contains(document.activeElement)) document.activeElement.blur();
        } catch (_) {}
        root.dataset.collapsed = "true";
        revealEl = h("div", { class: "zentral-notes-reveal", "aria-hidden": "true" });
        revealEl.addEventListener("mouseenter", () => {
          window.clearTimeout(openTimer);
          openTimer = window.setTimeout(() => expand(true), timing().openMs);
        });
        revealEl.addEventListener("mouseleave", () => {
          window.clearTimeout(openTimer);
          openTimer = 0;
        });
        // The strip is a visible target: pressing it opens the sheet at once, and a pointer that arrives
        // fast (it overshoots instead of resting on a 1 px edge) is not made to wait the full delay.
        revealEl.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          expand(false);
        });
        revealEl.addEventListener("mousemove", (e) => {
          if (!openTimer || !(Math.abs(e.movementY || 0) + Math.abs(e.movementX || 0) > 30)) return;
          window.clearTimeout(openTimer);
          openTimer = window.setTimeout(() => expand(true), Math.min(timing().openMs, 40));
        });
        (adapter.host || root.parentNode || document.documentElement).appendChild(revealEl);
        adapter.setActive(false, { strip: true });
        applyPush(0, 0);
        placeReveal();
        scheduleLayout();
      }
      function dropReveal() {
        window.clearTimeout(openTimer);
        openTimer = 0;
        revealEl?.remove();
        revealEl = null;
      }
      function expand(fromHover) {
        window.clearTimeout(openTimer);
        openTimer = 0;
        if (!collapsed) return;
        collapsed = false;
        delete root.dataset.collapsed;
        dropReveal();
        adapter.setActive(true);
        applyPush(0, 0);
        raise();
        scheduleLayout();
        // Opened by hovering: do not steal the focus; fold away again if the pointer never reaches the sheet.
        if (fromHover) armGrace();
      }
      const scheduleLayout = () => {
        if (!rafLayout) rafLayout = window.requestAnimationFrame(layout);
      };

      // ---- top layer (standalone card only) -------------------------------------------------------
      // Big Preview lives in the browser's top layer, which no z-index outranks. While Notes has the
      // focus the card is a manual popover shown after Big Preview, so it sits above it; when something
      // else is pressed the popover is dropped (the attribute is removed so the card stays visible as a
      // normal layer) and Big Preview is above again.
      let topLayer = false;
      function raise() {
        if (adapter.position !== "fixed" || !isOpen || destroyed || root.hidden || typeof root.showPopover !== "function") return;
        try {
          if (topLayer && root.matches(":popover-open")) root.hidePopover();
          root.setAttribute("popover", "manual");
          root.showPopover();
          topLayer = true;
        } catch (_) {
          topLayer = false;
        }
      }
      function drop() {
        if (!topLayer) return;
        topLayer = false;
        try {
          if (root.matches(":popover-open")) root.hidePopover();
        } catch (_) {}
        root.removeAttribute("popover");
      }
      const focusInside = () => root.contains(document.activeElement);
      listen(root, "pointerdown", () => {
        outsideClaim = false;
        if (!topLayer || !focusInside()) raise();
      }, true);
      listen(root, "focusin", () => {
        if (!topLayer) raise();
      });
      // The entrance animation plays once per open; entering or leaving the top layer must not replay it.
      listen(root, "animationend", () => {
        root.dataset.settled = "true";
      });
      // A press anywhere outside the sheet: leave the top layer and, when the window is not pinned,
      // close (as the panels do). The bar's own button and the browser chrome are exempt.
      const EXEMPT_IDS = ["navigator-toolbox", "sidebar-box", "PersonalToolbar", "nav-bar", "zentral-settings-modal"];
      function isExempt(target, path) {
        if (adapter.ignoreOutside?.(target, path)) return true;
        const nodes = path && path.length ? path : [];
        for (const el of nodes) {
          if (el?.classList?.contains?.("zentral-notes-sheet") || el?.classList?.contains?.("zentral-notes-btn")) return true;
          if (el?.id && (EXEMPT_IDS.includes(el.id) || el.id.includes("sine"))) return true;
        }
        if (target?.closest) {
          for (const id of EXEMPT_IDS) if (target.closest("#" + id)) return true;
          if (target.closest(".zentral-notes-btn") || target.closest(".zentral-notes-sheet")) return true;
        }
        return false;
      }
      const onOutsidePress = (e) => {
        if (!isOpen || destroyed || gesture) return;
        const path = e.composedPath ? e.composedPath() : [];
        if (root.contains(e.target) || path.includes(root)) return;
        // A press on the Notes button / browser chrome is not the user moving to a web field.
        if (!isExempt(e.target, path)) outsideClaim = true;
        drop();
        // A panel-hosted sheet follows its mode (pin / dock stay, hover folds away when the pointer leaves).
        if (adapter.pushPanel) return;
        if (store.meta.pinned !== false) return;
        if (isExempt(e.target, path)) return;
        close();
      };
      const onPress = () => {
        ptrDown = true;
      };
      const onRelease = () => {
        ptrDown = false;
        armGrace();
      };
      listen(root, "mouseenter", () => {
        ptrInside = true;
        window.clearTimeout(graceTimer);
        graceTimer = 0;
      });
      listen(root, "mouseleave", () => {
        ptrInside = false;
        armGrace();
      });
      listen(root, "focusout", () => armGrace());

      // ---- open / close -------------------------------------------------------------
      async function open() {
        if (destroyed) return;
        if (isOpen) {
          if (collapsed) expand(false);
          focusEditor();
          return;
        }
        isOpen = true;
        outsideClaim = false;
        adapter.attach(root);
        root.hidden = false;
        mode = startMode(getPref(PREF.DEFAULT_VIEW, "last"), store.meta.mode);
        applyState();
        // A panel-hosted sheet takes its slot first, so the first frame already shows the split.
        if (adapter.pushPanel) applyPush(0, 0);
        layout();
        unwatch = adapter.watch(scheduleLayout);
        window.addEventListener("mousedown", onOutsidePress, true);
        window.addEventListener("mousedown", onPress, true);
        window.addEventListener("mouseup", onRelease, true);
        adapter.setActive(true);
        raise();
        try {
          await ensureStore();
        } catch (error) {
          console.warn("[ZentralNotes] store unavailable", error);
          statusEl.textContent = "Notes folder unavailable";
          return;
        }
        if (!isOpen || destroyed) return;
        // W9: a forced start view is also stored, so opening another note later keeps whatever the user switches to.
        mode = startMode(getPref(PREF.DEFAULT_VIEW, "last"), store.meta.mode);
        if (mode !== store.meta.mode) store.setMeta({ mode });
        if (adapter.kind) store.setMeta({ openIn: adapter.kind });
        store.refresh().catch(() => {});
        const id = store.latestId();
        if (id) openNote(id);
        else newNote();
        layout();
      }
      function close() {
        if (!isOpen) return;
        isOpen = false;
        collapsed = false;
        delete root.dataset.collapsed;
        dropReveal();
        window.clearTimeout(graceTimer);
        graceTimer = 0;
        ptrDown = false;
        ptrInside = false;
        cancelGesture();
        applyPush(0, 0);
        closeMenu();
        closeDialog();
        window.clearTimeout(previewTimer);
        previewTimer = 0;
        if (currentId) store.discardIfEmpty(currentId);
        // Closing by hand forgets "open in", a window or panel going away keeps it (restored with Open on Startup).
        if (adapter.kind && !destroying) store.setMeta({ openIn: "" });
        store.flush();
        window.removeEventListener("mousedown", onOutsidePress, true);
        window.removeEventListener("mousedown", onPress, true);
        window.removeEventListener("mouseup", onRelease, true);
        endGesture();
        drop();
        root.hidden = true;
        delete root.dataset.settled;
        try {
          unwatch?.();
        } catch (_) {}
        unwatch = null;
        adapter.setActive(false);
        adapter.onClosed?.({ manual: !destroying });
      }
      let destroying = false;
      function destroy() {
        if (destroyed) return;
        destroying = true;
        if (isOpen) close();
        destroyed = true;
        offStore();
        for (const fn of cleanups.splice(0).reverse()) {
          try {
            fn();
          } catch (_) {}
        }
        window.clearTimeout(confirmTimer);
        window.clearTimeout(previewTimer);
        window.clearTimeout(flashTimer);
        window.clearTimeout(findTimer);
        window.clearTimeout(graceTimer);
        window.clearTimeout(openTimer);
        for (const id of [rafChrome, rafList, rafLayout, rafSync]) if (id) window.cancelAnimationFrame(id);
        window.removeEventListener("mousedown", onOutsidePress, true);
        window.removeEventListener("mousedown", onPress, true);
        window.removeEventListener("mouseup", onRelease, true);
        dropReveal();
        root.remove();
      }
      // A read option (blank lines, line breaks, Setext) changed: draw the read pane again.
      function refreshRead() {
        if (!isOpen || destroyed || view !== "editor") return;
        resetRead();
        if (mode !== "edit") renderRead();
      }
      return {
        root,
        open,
        close,
        destroy,
        refreshRead,
        layout: scheduleLayout,
        applyState,
        focus: () => {
          outsideClaim = false; // an explicit request (shortcut, command) may take the focus
          focusEditor();
        },
        // A collapsed (hover) sheet counts as closed for the button and the shortcuts: using them opens it.
        isOpen: () => isOpen && !collapsed,
        toggle: () => (isOpen && !collapsed ? close() : open()),
        newNote: (folderId) => {
          if (isOpen && !destroyed) newNote(folderId);
        },
        quickCaptureToday: () => {
          if (isOpen && !destroyed) queueMicrotask(() => askQuickCapture(""));
        },
        openNoteById: (id) => {
          if (!isOpen || destroyed || !store.get(id)) return false;
          outsideClaim = false;
          openNote(id);
          return true;
        },
      };
    }

    // ======================================================================
    // Host adapters: where a sheet lives and which area it covers
    // ======================================================================
    // Bars hold the Notes button. The sheet is always a child of the panel
    // slider (primary / Triple View) or of the Super Pin shell, positioned
    // over the page area of the browser that bar belongs to. It never moves
    // or reloads that browser.
    // The slot a panel-hosted sheet takes is ONE thing per window: the CSS variables it sets on the root are
    // shared by every bar (main panel, Triple View bottom bar, Super Pin). So the state lives here, not in
    // each adapter, and only the owner may change or release it. (Per-adapter copies went stale when another
    // bar released the variable, which put the sheet below the panel and overcounted the free height.)
    const SLOT = { owner: null, px: 0, gap: false, quad: false, pseudo: false, up: -1, suspended: null };
    function releaseSlot() {
      SLOT.suspended = null;
      if (!SLOT.owner && !SLOT.px) return;
      const r = document.documentElement;
      SLOT.owner = null;
      SLOT.px = 0;
      SLOT.gap = SLOT.quad = SLOT.pseudo = false;
      SLOT.up = -1;
      r.style.removeProperty("--zentral-notes-panel-reserve");
      r.style.removeProperty("--zentral-notes-gap");
      r.style.removeProperty("--zentral-notes-gap-up");
      r.removeAttribute("bgalazka-quad-view");
      r.removeAttribute("bgalazka-notes-pseudo");
      r.removeAttribute("bgalazka-notes-gap");
      r.removeAttribute("bgalazka-notes-spill");
      try {
        document.dispatchEvent(new Event("zentral-notes-reserve"));
      } catch (_) {}
    }
    function createBarAdapter({ kind, barEl, button, widePercent = () => 2 }) {
      const slider = () => document.getElementById("zen-app-panel-slider");
      const shell = () => barEl.closest("#bgalazka-super-panel");
      const host = () => (kind === "super" ? shell() : slider());
      function browserEl() {
        if (kind === "super")
          return shell()?.querySelector(":scope > browser") || null;
        const list = [...(slider()?.querySelectorAll(":scope > browser") || [])].filter(
          (b) => !b.hidden && b.getClientRects().length,
        );
        if (!list.length) return null;
        const slot = kind === "triple" ? "bottom" : "top";
        const bySlot = list.find((b) => b.getAttribute("data-bgalazka-triple-slot") === slot);
        return bySlot || (kind === "primary" ? list[0] : null);
      }
      let observeAll = () => {};
      const mine = () => SLOT.owner === api && SLOT.px > 0;
      // Union of every visible page of the panel (one in a normal panel, two in Triple View).
      function pageSpan() {
        const rects = [...(slider()?.querySelectorAll(":scope > browser") || [])]
          .filter((x) => !x.hidden && x.getClientRects().length)
          .map((x) => x.getBoundingClientRect())
          .filter((r) => r.width > 40 && r.height > 40);
        if (!rects.length) return { left: 0, top: 0, width: 0, height: 0, bottom: 0 };
        const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right)), bottom = Math.max(...rects.map((r) => r.bottom));
        return { left, top, width: right - left, height: bottom - top, bottom };
      }
      // What the pages would measure with nothing reserved, whoever currently holds the reserve. Between the
      // panels the gap lies INSIDE the pages' union (subtract it); at the bottom it lies outside (add it).
      function pagesWithoutSlot() {
        const h2 = pageSpan().height;
        // Triple View's divider margin grows inside a fixed-height flex column: the two browser slots shrink
        // by the same amount, so their union still spans the original panel height. Do not subtract the gap a
        // second time or each layout pass would progressively collapse the Notes band. A dock/quad reserve,
        // in contrast, is outside the browser union and must be added back.
        return pagesWithoutSlotHeight({ pageHeight: h2, slotPx: SLOT.px, slotKind: SLOT.gap ? "gap" : "dock" });
      }
      const api = {
        position: "absolute",
        geoKey: "panel",
        kind,
        get host() {
          return host();
        },
        // The button that opens this sheet must not count as an "outside" press.
        ignoreOutside: (target) => !!target && (button === target || button.contains?.(target)),
        attach(root) {
          const h2 = host();
          if (h2 && root.parentNode !== h2) h2.appendChild(root);
        },
        // V4-R2: the bottom bar of Triple View sits at the divider, so its sheet goes BETWEEN the two panels
        // (a gap at the divider); every other bar's sheet is an overlay on its own panel.
        placement: () => (kind === "triple" && document.documentElement.hasAttribute("bgalazka-triple-view") ? "between" : "overlay"),
        // Button state: data-mode says where the sheet lives; the icon follows it.
        syncMode() {
          const mode = api.placement();
          if (button.dataset.mode === mode) return;
          button.dataset.mode = mode;
          button.replaceChildren(icon(mode === "between" ? "noteBetween" : "note", 14));
        },
        // "dock" = a band at the bottom of the panel(s), "gap" = a gap between the two panels, "" = overlay.
        slotKind: () => (mine() ? (SLOT.gap ? "gap" : "dock") : ""),
        // What a drag of the slot's edge starts from: its height now and the pages' height without it.
        slotInfo: () => {
          if (!mine()) return null;
          let up = SLOT.up;
          if (SLOT.gap && !(up >= 0)) {
            // Proportional gap: the slider publishes both panels' live heights; the gap was shared in that ratio.
            const cs = slider()?.style;
            const t = parseFloat(cs?.getPropertyValue?.("--bgalazka-top-share")), b = parseFloat(cs?.getPropertyValue?.("--bgalazka-bottom-share"));
            up = Number.isFinite(t) && Number.isFinite(b) && t + b > 0 ? Math.round((SLOT.px * t) / (t + b)) : Math.round(SLOT.px / 2);
          }
          let roomUp = Infinity, roomDown = Infinity;
          if (SLOT.gap) {
            const cs = slider()?.style;
            const t = parseFloat(cs?.getPropertyValue?.("--bgalazka-top-share")), b = parseFloat(cs?.getPropertyValue?.("--bgalazka-bottom-share"));
            if (Number.isFinite(t)) roomUp = Math.max(0, t - GAP_PANEL_MIN_PX);
            if (Number.isFinite(b)) roomDown = Math.max(0, b - GAP_PANEL_MIN_PX);
          }
          return { px: SLOT.px, base: pagesWithoutSlot(), gap: SLOT.gap, up: SLOT.gap ? up : 0, down: SLOT.gap ? SLOT.px - up : 0, roomUp, roomDown };
        },
        // A plain panel stretched top-to-bottom has no room to give: Notes stays inactive (no reserve, no hit area).
        stretched() {
          const rootEl = document.documentElement;
          if (kind !== "primary" || rootEl.hasAttribute("bgalazka-triple-view")) return false;
          const pr = document.getElementById("zen-app-panel-root")?.getBoundingClientRect?.();
          if (!pr) return false;
          const content = document.getElementById("tabbrowser-tabbox")?.getBoundingClientRect?.();
          const reserve = SLOT.owner === api && !SLOT.gap && !SLOT.quad ? SLOT.px : 0;
          return panelSpansFullHeight({ top: pr.top, bottom: pr.bottom, reserve, areaTop: content && content.height > 0 ? content.top : 0, windowHeight: window.innerHeight });
        },
        suspended: () => SLOT.suspended === api,
        // Push page for a panel-hosted sheet. `fraction` of the panel's page height is handed to the sheet
        // (0 = give it back); `strip` > 0 reserves just that many px (hover mode's thin real band). Overlay:
        // the geometry module reads --zentral-notes-panel-reserve and shortens the panel. Between: the
        // secondary-views module reads --zentral-notes-gap and opens a gap at the divider (both panels
        // shrink by their share). Returns true while the sheet is a layout slot of Triple View.
        pushPanel(fraction, { strip = 0, px: wantPx = 0, up: wantUp = -1, upFrac = -1 } = {}) {
          const rootEl = document.documentElement;
          let wants = strip > 0 || fraction > 0 || wantPx > 0;
          const between = api.placement() === "between";
          // A panel stretched from the top to the bottom of the window gives nothing: no reserve, no stale margin.
          // A plain panel (no Triple View) becomes a pseudo Triple View: page on top, a clean band for Notes below it,
          // both INSIDE the panel (padding on the slider), so the panel is never shortened and "stretched" is moot.
          const pseudoOk = kind === "primary" && !rootEl.hasAttribute("bgalazka-triple-view");
          if (wants && !between && !pseudoOk && api.stretched()) {
            wants = false;
            SLOT.suspended = api;
          } else if (SLOT.suspended === api) SLOT.suspended = null;
          // Only the owner may give the reserve back; a bar that holds nothing leaves another bar's slot alone.
          if (!wants && SLOT.owner !== api) return false;
          const base = pagesWithoutSlot();
          const px = !wants ? 0 : wantPx > 0 ? clampSlotPx(base, wantPx) : strip > 0 && base > 200 ? Math.round(strip) : slotPx(base, fraction);
          const up = !between || px <= 0 ? -1 : wantUp >= 0 ? Math.min(Math.round(wantUp), px) : upFrac >= 0 ? Math.round(px * Math.min(1, upFrac)) : -1;
          const pseudo = !between && px > 0 && pseudoOk;
          const quad = !between && px > 0 && (pseudo || rootEl.hasAttribute("bgalazka-triple-view"));
          const hasQuad = rootEl.hasAttribute("bgalazka-quad-view");
          if (SLOT.owner === api && px === SLOT.px && between === SLOT.gap && quad === SLOT.quad && pseudo === SLOT.pseudo && quad === hasQuad && up === SLOT.up)
            return quad || (between && px > 0);
          if (px <= 0) {
            const stay = SLOT.suspended === api;
            releaseSlot();
            if (stay) SLOT.suspended = api;
            return false;
          }
          SLOT.owner = api;
          SLOT.px = px;
          SLOT.gap = between;
          SLOT.quad = quad;
          SLOT.pseudo = pseudo;
          SLOT.up = up;
          if (between && up >= 0) rootEl.style.setProperty("--zentral-notes-gap-up", up + "px");
          else rootEl.style.removeProperty("--zentral-notes-gap-up");
          if (between) rootEl.setAttribute("bgalazka-notes-gap", "true");
          else rootEl.removeAttribute("bgalazka-notes-gap");
          const [prop, other] = between ? ["--zentral-notes-gap", "--zentral-notes-panel-reserve"] : ["--zentral-notes-panel-reserve", "--zentral-notes-gap"];
          rootEl.style.setProperty(prop, px + "px");
          rootEl.style.removeProperty(other);
          if (quad) rootEl.setAttribute("bgalazka-quad-view", "true");
          else rootEl.removeAttribute("bgalazka-quad-view");
          if (pseudo) rootEl.setAttribute("bgalazka-notes-pseudo", "true");
          else rootEl.removeAttribute("bgalazka-notes-pseudo");
          document.dispatchEvent(new Event("zentral-notes-reserve"));
          // The panel may not be listening yet (load order) or may rewrite its own margin while it opens:
          // say it again once the frame and the open animation have settled. The geometry module only writes
          // when the margin differs, so a repeat costs nothing; it is skipped when the slot has moved on.
          const again = () => {
            if (SLOT.owner !== api || SLOT.px !== px) return;
            try {
              document.dispatchEvent(new Event("zentral-notes-reserve"));
            } catch (_) {}
          };
          window.requestAnimationFrame(again);
          window.setTimeout(again, 300);
          return quad || between;
        },
        // The band the sheet (or, collapsed, the hover strip) occupies in the layout, or null.
        bandRect() {
          if (!mine()) return null;
          const bb = pageSpan();
          if (bb.width <= 40) return null;
          if (SLOT.gap) {
            const d = slider()?.querySelector(":scope > .bgalazka-triple-divider")?.getBoundingClientRect?.();
            if (d && d.height > 0) return { left: bb.left, top: d.top - SLOT.px, width: bb.width, height: SLOT.px };
          }
          // Pseudo Triple View: the band is the padding at the bottom of the slider, inside the panel.
          if (SLOT.pseudo) {
            const sr = slider()?.getBoundingClientRect?.();
            if (sr && sr.width > 40 && sr.height > SLOT.px) return { left: sr.left, top: sr.bottom - SLOT.px, width: sr.width, height: SLOT.px };
          }
          // Plain docked panel: the URL bar is part of the panel (below its pages by default). Start below the whole
          // panel, not below the pages, or the band sits on top of the URL bar.
          const panelBottom = SLOT.quad ? NaN : document.getElementById("zen-app-panel-root")?.getBoundingClientRect?.()?.bottom;
          return { left: bb.left, top: dockBandTop({ pageBottom: bb.bottom, panelBottom }), width: bb.width, height: SLOT.px };
        },
        // Split view widens the sheet beyond the panel: it grows from the panel's inner edge toward the
        // middle of the window and may cover part of the page (the panel and its bar stay visible).
        getArea({ span = false, wide = false } = {}) {
          const area = api.baseArea({ span });
          if (!wide || !area || span || area.fill) return area;
          const vw = window.innerWidth;
          const w = Math.min(Math.round(area.width * widePercent()), vw - 16);
          if (w <= area.width + 8) return area;
          const left = area.left + area.width / 2 > vw / 2 ? Math.max(8, area.left + area.width - w) : Math.min(area.left, vw - w - 8);
          const pill = document.getElementById("zen-app-panel-pill")?.getBoundingClientRect?.();
          const out = clearOfRect({ ...area, left, width: w }, pill);
          return { ...out, wideFill: true };
        },
        // V4-R3: while the sheet is wider than the panel (split / span), or its band lies below the shortened
        // panel (a plain panel gives the height up from its bottom), the clip and slider stop clipping.
        setSpill(on) {
          const r = document.documentElement;
          if (on) r.setAttribute("bgalazka-notes-spill", "true");
          else r.removeAttribute("bgalazka-notes-spill");
        },
        baseArea({ span = false } = {}) {
          if (mine()) {
            // The band IS the sheet's slot: it fills it (no peek size, no remembered box). A plain panel's band
            // is the room the panel gave up beneath itself, outside the clip: flagged so the sheet can spill.
            const band = api.bandRect();
            if (band) return { ...band, anchor: "top", fill: true, outside: !SLOT.gap && !SLOT.quad };
          }
          // Hold-to-fill: one rectangle around every visible page of the panel (both views in Triple View).
          if (span) {
            const rects = [...(slider()?.querySelectorAll(":scope > browser") || [])]
              .filter((x) => !x.hidden && x.getClientRects().length)
              .map((x) => x.getBoundingClientRect())
              .filter((r) => r.width > 40 && r.height > 40);
            if (rects.length) {
              const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top));
              const right = Math.max(...rects.map((r) => r.right)), bottom = Math.max(...rects.map((r) => r.bottom));
              return { left, top, width: right - left, height: bottom - top, anchor: "top" };
            }
          }
          const b = browserEl();
          if (b) {
            const r = b.getBoundingClientRect();
            if (r.width > 40 && r.height > 40)
              return { left: r.left, top: r.top, width: r.width, height: r.height, anchor: "top" };
          }
          const h2 = host();
          if (!h2) return null;
          const hr = h2.getBoundingClientRect(),
            br = barEl.getBoundingClientRect();
          return { left: hr.left, top: br.bottom, width: hr.width, height: hr.bottom - br.bottom, anchor: "top" };
        },
        watch(cb) {
          const ro = new ResizeObserver(cb);
          observeAll = () => {
            ro.disconnect();
            const h2 = host();
            if (h2) ro.observe(h2);
            for (const b of slider()?.querySelectorAll(":scope > browser") || []) ro.observe(b);
            const own = shell()?.querySelector(":scope > browser");
            if (own) ro.observe(own);
          };
          observeAll();
          window.addEventListener("resize", cb);
          return () => {
            ro.disconnect();
            observeAll = () => {};
            window.removeEventListener("resize", cb);
          };
        },
        rewatch: () => observeAll(),
        setActive(on, { strip = false } = {}) {
          if (!on) {
            if (!strip) api.pushPanel(0);
            api.setSpill(false);
          }
          api.syncMode();
          button.dataset.active = on ? "true" : "false";
          button.setAttribute("aria-pressed", on ? "true" : "false");
        },
        onClosed: null,
      };
      // Super Pin is a separate floating shell: its sheet stays an overlay and never reserves main-panel height.
      if (kind === "super") {
        delete api.pushPanel;
        delete api.slotKind;
        delete api.slotInfo;
      }
      return api;
    }
    // The floating card. With `docked()` on it opens beside the Zen sidebar (on the
    // content side, whichever side the sidebar is on) instead of in the window corner.
    function createFloatingAdapter({ widePercent = () => 1.96, docked = () => false, avoidSidebar = () => false, onActive = () => {}, isTrigger = () => false } = {}) {
      const toolbox = () => document.getElementById("navigator-toolbox");
      const sidebarRect = () => {
        const sr = toolbox()?.getBoundingClientRect();
        return sr && sr.width > 20 && sr.height > 20 ? sr : null;
      };
      return {
        position: "fixed",
        host: document.documentElement,
        // Docked or floating, the card's place is remembered (docked has its own slot, so switching the dock
        // option never moves the floating card).
        get geoKey() {
          return docked() ? "dock" : "float";
        },
        ignoreOutside: (target) => isTrigger(target),
        attach(root) {
          root.dataset.host = docked() ? "dock" : "float";
          if (root.parentNode !== document.documentElement) document.documentElement.appendChild(root);
        },
        getArea({ wide = false, span = false } = {}) {
          const sr = sidebarRect();
          if (docked()) {
            if (sr) {
              const content = document.getElementById("appcontent")?.getBoundingClientRect();
              const onRight = sr.left > window.innerWidth / 2;
              const room = onRight ? sr.left : window.innerWidth - sr.right;
              const w = Math.max(240, Math.min(440, room - 8));
              return {
                left: onRight ? sr.left - w : sr.right,
                top: content && content.height > 100 ? content.top : 0,
                width: w,
                height: content && content.height > 100 ? content.height : window.innerHeight,
                anchor: "top",
                bounds: { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
              };
            }
          }
          // Standalone: keep out of the native sidebar's space and start on the opposite side (the sidebar
          // used to cover the card and catch its clicks). The whole window is the area it may be moved in.
          const vw = window.innerWidth, vh = window.innerHeight;
          let view = { left: 0, top: 0, width: vw, height: vh };
          let side = "right";
          if (avoidSidebar() && sr) {
            view = keepClear(view, [sr], vh);
            side = sideOf(sr, vw) === "right" ? "left" : "right";
          }
          if (span) return { left: view.left, top: view.top, width: view.width, height: view.height, anchor: "top", bounds: view };
          // Split view widens the card so the editor and the preview sit side by side.
          const w = Math.min(wide ? Math.round(460 * widePercent()) : 460, view.width - 20);
          const left = side === "right" ? view.left + view.width - w - 4 : view.left + 4;
          return { left, top: 4, width: w, height: vh - 8, anchor: "bottom", bounds: view };
        },
        watch(cb) {
          const ro = new ResizeObserver(cb);
          const tb = toolbox();
          if (tb) ro.observe(tb);
          window.addEventListener("resize", cb);
          return () => {
            ro.disconnect();
            window.removeEventListener("resize", cb);
          };
        },
        rewatch() {},
        setActive: (on) => onActive(on),
        // Push page: the page area gets a margin on the card's side while the card is open. Returns true
        // when it pushed. The margin lives in one root attribute + one variable, both removed again.
        push({ left, width }) {
          const rootEl = document.documentElement;
          const area = document.getElementById("tabbrowser-tabbox") || document.getElementById("appcontent");
          if (!area) return false;
          rootEl.removeAttribute("zentral-notes-push");
          const r = area.getBoundingClientRect();
          const amount = pushAmount({ left, width }, { left: r.left, right: r.right });
          if (!amount) return false;
          rootEl.style.setProperty("--zentral-notes-push", amount.px + "px");
          rootEl.setAttribute("zentral-notes-push", amount.side);
          return true;
        },
        unpush() {
          const rootEl = document.documentElement;
          rootEl.removeAttribute("zentral-notes-push");
          rootEl.style.removeProperty("--zentral-notes-push");
        },
        onClosed: null,
      };
    }

    function parseShortcut(text) {
      const spec = { alt: false, ctrl: false, shift: false, meta: false, key: "" };
      for (const raw of String(text || "").split("+")) {
        const p = raw.trim().toLowerCase();
        if (!p) continue;
        if (p === "alt" || p === "option") spec.alt = true;
        else if (p === "ctrl" || p === "control") spec.ctrl = true;
        else if (p === "shift") spec.shift = true;
        else if (p === "meta" || p === "cmd" || p === "command" || p === "super") spec.meta = true;
        else spec.key = p;
      }
      // A bare key would hijack typing, so a modifier is mandatory.
      return spec.key && (spec.alt || spec.ctrl || spec.meta) ? spec : null;
    }
    function matchesShortcut(e, spec) {
      if (!spec || !!e.altKey !== spec.alt || !!e.ctrlKey !== spec.ctrl || !!e.shiftKey !== spec.shift || !!e.metaKey !== spec.meta)
        return false;
      const key = String(e.key || "").toLowerCase();
      return key === spec.key || (spec.key.length === 1 && (e.code === "Key" + spec.key.toUpperCase() || e.code === "Digit" + spec.key));
    }
    const isAbsolutePath = (p) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p);

    // ======================================================================
    // Real I/O, file pickers and the feature entry point
    // ======================================================================
    const realIO = {
      join: (...parts) => PathUtils.join(...parts),
      filename: (p) => PathUtils.filename(p),
      readUTF8: (p) => IOUtils.readUTF8(p),
      writeUTF8: (p, text, opts) => IOUtils.writeUTF8(p, text, opts),
      remove: (p) => IOUtils.remove(p, { ignoreAbsent: true }),
      exists: (p) => IOUtils.exists(p),
      children: (p) => IOUtils.getChildren(p),
      stat: (p) => IOUtils.stat(p),
      // Pictures (P2): binary files below assets/<note id>/ only; "create" never overwrites an existing file.
      makeDir: (p) => IOUtils.makeDirectory(p, { createAncestors: true, ignoreExisting: true }),
      writeBytes: (p, bytes) => IOUtils.write(p, bytes, { mode: "create" }),
      readBytes: (p) => IOUtils.read(p),
      removeTree: (p) => IOUtils.remove(p, { recursive: true, ignoreAbsent: true }),
      // Owner-only permissions where the platform supports them.
      restrict: (p) =>
        /^Win/i.test(navigator.platform || "")
          ? Promise.resolve()
          : IOUtils.setPermissions(p, 0o600, false),
    };

    function start() {
      const cleanups = [];
      const onCleanup = (fn) => cleanups.push(fn);
      let disposed = false;
      const warn = (error) => console.warn("[ZentralNotes]", error);
      const prefBool = (k, d) => {
        try {
          return Services.prefs.getBoolPref(k, d);
        } catch (_) {
          return d;
        }
      };
      const prefStr = (k, d) => {
        try {
          return Services.prefs.getStringPref(k, d);
        } catch (_) {
          return d;
        }
      };
      const prefInt = (k, d) => {
        try {
          return Services.prefs.getIntPref(k, d);
        } catch (_) {
          return d;
        }
      };
      const enabledNow = () => prefBool(PREF.ENABLED, true);
      const windowId = Math.random().toString(36).slice(2);

      // ---- store (created now, opened on first use) -------------------------
      async function resolveDir() {
        const fallback = realIO.join(PathUtils.profileDir, "zentral-notes");
        const custom = prefStr(PREF.FOLDER, "").trim();
        const wanted = custom && isAbsolutePath(custom) ? custom : fallback;
        const make = async (dir) => {
          await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
          if (!/^Win/i.test(navigator.platform || ""))
            await IOUtils.setPermissions(dir, 0o700, false).catch(() => {});
          return dir;
        };
        try {
          return await make(wanted);
        } catch (error) {
          if (wanted === fallback) throw error;
          warn("Notes folder unusable, using the profile folder: " + error);
          return make(fallback);
        }
      }
      const store = createStore({
        io: realIO,
        notify: (msg) => {
          try {
            Services.obs.notifyObservers(null, OBS_TOPIC, JSON.stringify(msg));
          } catch (_) {}
        },
        windowId,
        getDir: resolveDir,
        getMaxSaveMs: () =>
          Math.max(2, Math.min(60, prefInt(PREF.AUTOSAVE, DEFAULT_MAX_SAVE_SECONDS))) * 1000,
        getTrashDays: () => cleanTrashDays(prefInt(PREF.TRASH_DAYS, TRASH_DAYS)),
        getHistory: () => ({
          on: prefBool(PREF.HISTORY_ON, true),
          ...historyOptions({ keep: prefInt(PREF.HISTORY_KEEP, HISTORY_DEFAULTS.keep), minutes: prefInt(PREF.HISTORY_MINUTES, HISTORY_DEFAULTS.minutes), capKB: prefInt(PREF.HISTORY_CAP_KB, HISTORY_DEFAULTS.capKB), warnMB: prefInt(PREF.HISTORY_WARN_MB, HISTORY_DEFAULTS.warnMB) }),
        }),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (id) => window.clearTimeout(id),
        warn,
      });
      const remoteObserver = {
        observe(_subject, topic, data) {
          if (topic === OBS_TOPIC) store.onRemoteMessage(data);
        },
      };
      let storePromise = null;
      function ensureStore() {
        if (!storePromise)
          storePromise = store
            .open()
            .then(() => {
              if (!disposed) Services.obs.addObserver(remoteObserver, OBS_TOPIC);
            })
            .catch((error) => {
              storePromise = null;
              throw error;
            });
        return storePromise;
      }
      onCleanup(() => {
        try {
          Services.obs.removeObserver(remoteObserver, OBS_TOPIC);
        } catch (_) {}
      });
      const quitObserver = {
        observe() {
          store.flush();
        },
      };
      try {
        Services.obs.addObserver(quitObserver, "quit-application-granted");
        onCleanup(() => {
          try {
            Services.obs.removeObserver(quitObserver, "quit-application-granted");
          } catch (_) {}
        });
      } catch (_) {}

      // ---- environment services for sheets ------------------------------------
      const copyText = (text) => {
        try {
          Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
        } catch (error) {
          warn(error);
        }
      };
      const openLink = (url) => {
        const safe = safeHref(url);
        if (!safe) return;
        try {
          window.gBrowser.addTab(safe, {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
        } catch (error) {
          warn(error);
        }
      };
      function pick(mode, title, defaultName, format = "md") {
        return new Promise((resolve) => {
          try {
            const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
            fp.init(window.browsingContext, title, mode);
            if (defaultName) fp.defaultString = defaultName;
            if (mode === Ci.nsIFilePicker.modeSave) {
              const info = EXPORT_FORMATS[format] || EXPORT_FORMATS.md;
              fp.appendFilter(`${info.label} (*.${info.ext})`, "*." + info.ext);
              fp.appendFilters(Ci.nsIFilePicker.filterAll);
              fp.defaultExtension = info.ext;
            }
            fp.open((rv) =>
              resolve(
                rv === Ci.nsIFilePicker.returnOK || rv === Ci.nsIFilePicker.returnReplace ? fp.file : null,
              ),
            );
          } catch (error) {
            warn(error);
            resolve(null);
          }
        });
      }
      const readOpts = () => ({
        joinLines: prefStr(PREF.LINE_BREAKS, "break") === "join",
        keepBlanks: prefStr(PREF.BLANK_LINES, "collapse") === "keep",
        setext: prefBool(PREF.SETEXT, false),
      });
      // One typed accessor pair for the sheets' quick settings and shortcut editor.
      const getPref = (k, d) => (typeof d === "boolean" ? prefBool(k, d) : typeof d === "number" ? prefInt(k, d) : prefStr(k, d));
      const setPref = (k, v) => {
        try {
          if (typeof v === "boolean") Services.prefs.setBoolPref(k, v);
          else if (typeof v === "number") Services.prefs.setIntPref(k, Math.round(v));
          else Services.prefs.setStringPref(k, String(v));
        } catch (e) {
          warn(e);
        }
      };
      const withNewline = (t) => (t.endsWith("\n") ? t : t + "\n");
      const allNotesForExport = () => store.list().concat(store.list({ trashed: true }));
      async function exportNote(n, format = "md") {
        const info = EXPORT_FORMATS[format] || EXPORT_FORMATS.md;
        const file = await pick(Ci.nsIFilePicker.modeSave, "Save note", safeFileName(titleOf(n.body), "note") + "." + info.ext, format);
        if (!file) return;
        try {
          const body = exportBody(n, allNotesForExport());
          const text = format === "html" ? exportHtml(body, readOpts()) : format === "txt" ? exportText(body, readOpts()) : withNewline(body);
          await IOUtils.writeUTF8(file.path, text);
        } catch (error) {
          warn(error);
        }
      }
      // PDF: the note is written as a page to a temporary file and opened in a tab; the page opens
      // the print dialog itself. The temporary folder is emptied of older files on every print.
      async function printNote(n) {
        try {
          const dir = PathUtils.join(PathUtils.tempDir, "zentral-notes-print");
          await IOUtils.makeDirectory(dir, { ignoreExisting: true });
          for (const old of await IOUtils.getChildren(dir).catch(() => [])) await IOUtils.remove(old, { ignoreAbsent: true }).catch(() => {});
          const path = PathUtils.join(dir, safeFileName(titleOf(n.body), "note") + ".html");
          await IOUtils.writeUTF8(path, exportHtml(exportBody(n, allNotesForExport()), readOpts(), { print: true }));
          window.gBrowser.addTab(PathUtils.toFileURI(path), {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
        } catch (error) {
          warn(error);
        }
      }
      async function exportAll(list) {
        const folder = await pick(Ci.nsIFilePicker.modeGetFolder, "Export all notes to a folder");
        if (!folder) return;
        const names = uniqueFileNames(list);
        const byId = new Map(list.map((x, i) => [x.id, names[i]]));
        const everything = allNotesForExport();
        for (let i = 0; i < list.length; i++) {
          try {
            // An existing file is never overwritten by an export.
            await IOUtils.writeUTF8(PathUtils.join(folder.path, names[i]), withNewline(exportBody(list[i], everything, byId)), { mode: "create" });
          } catch (error) {
            warn(error);
          }
        }
      }
      async function exportZip(list) {
        const live = list.filter((n) => !n.trashed);
        if (!live.length) return 0;
        const file = await pick(Ci.nsIFilePicker.modeSave, "Save all notes as zip", "zentral-notes.zip", "zip");
        if (!file) return 0;
        const names = uniqueFileNames(live);
        const byId = new Map(live.map((x, i) => [x.id, names[i]]));
        const everything = allNotesForExport();
        const zw = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
        try {
          zw.open(file, 0x04 | 0x08 | 0x20); // read/write, create, truncate
          const enc = new TextEncoder();
          for (let i = 0; i < live.length; i++) {
            const bytes = enc.encode(withNewline(exportBody(live[i], everything, byId)));
            let bin = "";
            for (let j = 0; j < bytes.length; j += 8192) bin += String.fromCharCode(...bytes.subarray(j, j + 8192));
            const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
            stream.setData(bin, bin.length);
            zw.addEntryStream(names[i], (live[i].updated || Date.now()) * 1000, Ci.nsIZipWriter.COMPRESSION_DEFAULT, stream, false);
          }
          return live.length;
        } catch (error) {
          warn(error);
          return 0;
        } finally {
          try {
            zw.close();
          } catch (_) {}
        }
      }
      // Import: every .md file of one folder (not its subfolders) becomes a new note. Files that are
      // large, unreadable or not text are skipped; nothing in the folder is changed.
      async function importFolder(store) {
        const folder = await pick(Ci.nsIFilePicker.modeGetFolder, "Import a folder of .md files");
        if (!folder) return 0;
        let count = 0;
        try {
          const files = (await IOUtils.getChildren(folder.path)).filter((f) => /\.md$/i.test(f)).sort().slice(0, MAX_IMPORT_FILES);
          for (const f of files) {
            try {
              const info = await IOUtils.stat(f);
              if (info.type !== "regular" || info.size > MAX_IMPORT_BYTES) continue;
              const { meta, body } = parseNoteText(await IOUtils.readUTF8(f));
              if (!body.trim()) continue;
              const created = store.create(body);
              if (NOTE_COLORS.includes(meta.color)) store.setColor(created.id, meta.color);
              if (meta.label) store.setLabel(created.id, meta.label);
              count++;
            } catch (error) {
              warn(error);
            }
          }
        } catch (error) {
          warn(error);
        }
        return count;
      }
      function revealFolder(dir) {
        if (!dir) return;
        try {
          const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
          f.initWithPath(dir);
          try {
            f.launch();
          } catch (_) {
            f.reveal();
          }
        } catch (error) {
          warn(error);
        }
      }
      // Pictures: bytes are read through the store (validated asset paths only) and shown from a local blob URL.
      // One URL per picture file is kept for the window's lifetime and revoked on teardown.
      const assetUrls = new Map();
      onCleanup(() => {
        for (const url of assetUrls.values()) {
          try { URL.revokeObjectURL(url); } catch (_) {}
        }
        assetUrls.clear();
      });
      async function loadAsset(rel) {
        if (assetUrls.has(rel)) return { url: assetUrls.get(rel) };
        const got = await store.readAsset(rel);
        if (!got || disposed) return null;
        const url = URL.createObjectURL(new Blob([got.bytes], { type: got.mime }));
        assetUrls.set(rel, url);
        return { url };
      }
      const env = { openLink, copyText, exportNote, exportAll, exportZip, importFolder, printNote, revealFolder, readOpts, getPref, setPref, loadAsset, now: () => Date.now() };

      // ---- reminders (P2): ONE coarse timer for the next due note, armed by the scheduler (no polling) ----
      let soundCtx = null;
      function playReminderSound() {
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) throw new Error("no audio");
          soundCtx?.close?.().catch?.(() => {});
          const ctx = (soundCtx = new Ctx());
          [0, 0.28].forEach((at) => {
            const osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
            gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22);
            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime + at);
            osc.stop(ctx.currentTime + at + 0.25);
          });
        } catch (_) {
          try { Services.sound.beep(); } catch (error) { warn(error); }
        }
      }
      onCleanup(() => { try { soundCtx?.close?.(); } catch (_) {} soundCtx = null; });
      // Where a click in Zen's own sidebar folder opens a note: the Zentral panel when one is showing (the Notes sheet
      // of that panel), otherwise the standalone card. Never a hidden panel.
      function zenTarget() {
        if (!panelsHidden()) {
          const shown = [...bindings.values()].filter((x) => x.visible());
          const b = (lastUsed && shown.includes(lastUsed) && lastUsed) || shown.find((x) => x.isOpen()) || (document.getElementById("zen-app-panel-root")?.hasAttribute("open") ? shown.find((x) => x.kind === "primary") : null);
          if (b) return b;
        }
        return ensureFloating();
      }
      function openReminderNote(id, { zenTab = false } = {}) {
        const b = zenTab ? zenTarget() : pickBinding();
        return Promise.resolve(b.open()).then(() => sheetOf(b)?.openNoteById?.(id)).catch(warn);
      }
      function showReminders(list) {
        if (disposed) return;
        playReminderSound();
        for (const n of list.slice(0, 5)) {
          const title = titleOf(n.body) || "Untitled note";
          let shown = false;
          try {
            const box = window.gBrowser.getNotificationBox();
            box.appendNotification("zentral-notes-reminder-" + n.id, { label: "Reminder: " + title, priority: box.PRIORITY_INFO_HIGH }, [
              { label: "Open note", callback: () => { openReminderNote(n.id); } },
              { label: "Snooze 10 min", callback: () => { store.snoozeReminder(n.id, 10); } },
              { label: "Snooze 1 hour", callback: () => { store.snoozeReminder(n.id, 60); } },
              { label: "Dismiss", callback: () => { store.setReminder(n.id, 0); } },
            ]);
            shown = true;
          } catch (error) {
            warn(error);
          }
          if (!shown) openReminderNote(n.id);
        }
      }
      const reminders = createReminderScheduler({
        store,
        now: () => Date.now(),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (id) => window.clearTimeout(id),
        onDue: showReminders,
      });
      onCleanup(() => reminders.destroy());
      // The store opens lazily; reminders need it, so open it shortly after startup (not on the critical path).
      const remindersBoot = window.setTimeout(() => {
        if (disposed || !enabledNow()) return;
        ensureStore().then(() => (disposed ? null : reminders.start())).catch(warn);
      }, 4000);
      onCleanup(() => window.clearTimeout(remindersBoot));

      // ---- Zen sidebar folder (EXPERIMENT, pref zen_folder = off | selected | all; not verified in a live Zen) ----
      // The browser is reached only here. Every call is wrapped by createZenFolder's kill switch.
      const ZEN_ROOT_ID = "bgalazka-zentral-notes";
      const zenMode = () => cleanZenMode(prefStr(PREF.ZEN_MODE, "off"));
      const zenRootEl = () => {
        const el = document.querySelector('zen-folder[bgalazka-notes-folder="true"]') || document.getElementById(ZEN_ROOT_ID);
        if (el && el.localName === "zen-folder" && !el.hasAttribute("bgalazka-notes-folder")) el.setAttribute("bgalazka-notes-folder", "true"); // adopt the restored folder
        return el && el.localName === "zen-folder" ? el : null;
      };
      const systemPrincipal = () => Services.scriptSecurityManager.getSystemPrincipal();
      let zenMoveBroken = false;
      const zenTabs = (root) => [...(root?.querySelectorAll?.("tab") || [])].filter((t) => /^(n:|root$|new:)/.test(t.getAttribute(NOTES_ATTR) || ""));
      const zenByKey = (root, key) => zenTabs(root).filter((t) => t.getAttribute(NOTES_ATTR) === key);
      const zenFolderByKey = (root, key) => [...(root?.querySelectorAll?.("zen-folder[bgalazka-notes-subfolder]") || [])].find((f) => f.getAttribute("bgalazka-notes-subfolder") === key) || null;
      // A tab is ours only when it carries our mark AND sits inside our own NOTES folder. Every Zen-side rule below
      // starts from this test, so no other tab, folder or menu is ever touched (a leftover marked tab is just a tab).
      const isOurTab = (tab) => {
        try { return !!tab?.hasAttribute?.(NOTES_ATTR) && !!tab.closest?.('zen-folder[bgalazka-notes-folder="true"]'); } catch (_) { return false; }
      };
      const tabUrl = (tab) => {
        try {
          const spec = tab.linkedBrowser?.currentURI?.spec || "";
          // A discarded (unloaded) tab reports a bare about:blank: our remembered address is the better answer then.
          return spec.startsWith(ZEN_URL_PREFIX) ? spec : tab._zentralNotesUrl || spec;
        } catch (_) { return tab?._zentralNotesUrl || ""; }
      };
      // True while our own code is changing tabs (and shortly after): the tab events it causes are not "someone else did it".
      let zenBusy = false;
      let zenQuietUntil = 0;
      const zenEventsIgnored = () => zenBusy || Date.now() < zenQuietUntil;
      // A tab that carries our address shape but not our mark: a session-restored, duplicated or re-opened leftover.
      // Checked by address, by label, and for pinned/pending tabs by what the session store saved. Cached per tab.
      const zenChecked = new WeakMap();
      function zenLooksOurs(t) {
        if (!t || t.hasAttribute?.(NOTES_ATTR)) return false;
        if (zenChecked.has(t)) return zenChecked.get(t);
        let yes = false;
        try {
          let u = "";
          try { u = t.linkedBrowser?.currentURI?.spec || ""; } catch (_) {}
          yes = /^about:blank#zn-/.test(u) || /^about:blank#zn-/.test(t.getAttribute("label") || "") || /^about:blank#zn-/.test(t._zentralNotesUrl || "");
          if (!yes && (t.pinned || t.hasAttribute("pending")) && (u === "" || u === "about:blank") && window.SessionStore?.getTabState) {
            const st = JSON.parse(window.SessionStore.getTabState(t));
            yes = (st.entries || []).some((e) => /^about:blank#zn-/.test(e?.url || ""));
          }
        } catch (_) {}
        if (yes || t.hasAttribute("pending") || t.pinned) zenChecked.set(t, yes); // a plain tab may still be loading its address
        return yes;
      }
      function zenPlace(tab, parentEl) {
        // Zen's own API for putting a tab into a folder is not documented here: try the two known shapes, verify, never guess twice.
        try { parentEl.addTabs?.([tab]); } catch (_) {}
        if (tab.closest?.("zen-folder") !== parentEl) { try { window.gBrowser.moveTabToExistingGroup?.(tab, parentEl); } catch (_) {} }
        return tab.closest?.("zen-folder") === parentEl;
      }
      function zenNewTab(url, key) {
        const tab = window.gBrowser.addTab(url, { skipAnimation: true, triggeringPrincipal: systemPrincipal() });
        tab.setAttribute(NOTES_ATTR, key); // marked BEFORE pinning, like the add-on host tabs
        tab._zentralNotesUrl = url;
        window.gBrowser.pinTab(tab);
        return tab;
      }
      // #6a: the seed tab exists only because gZenFolders.createFolder needs a tab. Unless the user asked for the
      // "New note" entry (pref zen_folder_new_button), it is closed right after the folder exists. If closing it makes
      // the folder vanish (Zen deletes empty folders), the seed is kept from then on (zenKeepSeed) and relabelled.
      let zenKeepSeed = false;
      const zenWantsSeed = () => zenKeepSeed || prefBool(PREF.ZEN_NEW_BUTTON, false);
      function zenSettleSeed(seed, folderEl) {
        try {
          if (!seed) return true;
          if (zenWantsSeed()) {
            seed.setAttribute("bgalazka-notes-label", "New note");
            seed.setAttribute("label", "New note");
            return true;
          }
          zenRemoveTab(seed);
          if (folderEl?.isConnected === false) {
            zenKeepSeed = true;
            warn("Zen folder: the folder disappeared without its seed tab; keeping the seed as a \"New note\" entry");
            return false;
          }
        } catch (error) { warn(error); }
        return true;
      }
      const zenRemoveTab = (tab) => {
        try { window.gBrowser.removeTab(tab, { animate: false, skipPermitUnload: true, skipSessionStore: true }); } catch (error) { warn(error); }
      };
      // Sub-folders must sit INSIDE their parent folder. createFolder's parentId option is not guaranteed in every Zen
      // build, so after creating, verify the real DOM parent and try the two known ways of adopting a folder.
      const zenParentOf = (el) => { try { return el.parentElement?.closest?.("zen-folder") || null; } catch (_) { return null; } };
      function zenNest(el, parentEl) {
        if (!el || !parentEl || el === parentEl) return false;
        if (zenParentOf(el) === parentEl) return true;
        for (const how of [
          () => parentEl.addTabs?.([el]),
          () => parentEl.addFolder?.(el),
          () => window.gBrowser.moveTabToExistingGroup?.(el, parentEl),
          () => (parentEl.childrenContainer || parentEl.querySelector?.(":scope > .tab-group-container"))?.appendChild?.(el),
        ]) {
          try { how(); } catch (_) {}
          if (zenParentOf(el) === parentEl) return true;
        }
        return false;
      }
      // Zen saves pinned tabs and folders in its session, so after a restart our folder (and our tabs) come back WITHOUT
      // the marks that only live in memory. Our own address shape is the proof they are ours: such leftovers are removed
      // (once per run) before anything is built, so there is never a second NOTES folder or a tab titled about:blank#zn-.
      let zenSwept = false;
      function zenSweepStale() {
        if (zenSwept) return;
        zenSwept = true;
        try {
          for (const t of [...(document.querySelectorAll?.("tab:not([" + NOTES_ATTR + "])") || [])]) if (zenLooksOurs(t)) zenRemoveTab(t);
          const root = zenRootEl();
          for (const f of [...(root?.querySelectorAll?.("zen-folder:not([bgalazka-notes-subfolder])") || [])])
            if (!f.querySelector("tab")) { try { f.delete?.(); } catch (_) {} }
        } catch (error) { warn(error); }
      }
      // Several ways to create a sub-folder are tried in turn and each result is checked against the real DOM;
      // when all of them fail the facts are logged once, so a report says what this Zen build supports.
      let zenDiagDone = false;
      function zenMakeSubfolder(e, parentEl) {
        const diag = [];
        const opts = { label: e.label, renameFolder: false, collapsed: false, workspaceId: window.gZenWorkspaces?.activeWorkspace };
        const tries = [
          // 1: the tab is put inside the parent first, so the new folder is made where the tab is
          ["seed in parent", () => { const sd = zenNewTab(zenNewUrl(e.id), "new:" + e.id); if (!zenPlace(sd, parentEl)) { zenRemoveTab(sd); return null; } return { seed: sd, el: window.gZenFolders.createFolder([sd], opts) }; }],
          // 2: the parentId option, then adopting the folder afterwards
          ["parentId", () => { const sd = zenNewTab(zenNewUrl(e.id), "new:" + e.id); return { seed: sd, el: window.gZenFolders.createFolder([sd], { ...opts, parentId: parentEl.id }) }; }],
        ];
        for (const [name, make] of tries) {
          let r = null;
          try { r = make(); } catch (error) { diag.push(name + " threw " + (error?.message || error)); }
          if (!r) { diag.push(name + ": no tab"); continue; }
          const el = (r.el && r.el.nodeType ? r.el : null) || r.seed.closest?.("zen-folder");
          if (el && el !== parentEl && zenNest(el, parentEl)) return { el, seed: r.seed };
          diag.push(name + ": " + (!el ? "no folder made" : el === parentEl ? "the parent came back" : "folder not inside the parent (it is inside " + (zenParentOf(el)?.id || "nothing") + ")"));
          zenRemoveTab(r.seed);
          if (el && el !== parentEl) { try { el.delete?.(); } catch (_) {} }
        }
        if (!zenDiagDone) {
          zenDiagDone = true;
          const info = "Zen folder: nesting failed (" + diag.join("; ") + "). Parent: addTabs=" + typeof parentEl.addTabs + " addFolder=" + typeof parentEl.addFolder + " childrenContainer=" + !!parentEl.childrenContainer + " createFolder.length=" + (window.gZenFolders?.createFolder?.length ?? "?");
          try { window.__zentralNotesZenDiag = info; } catch (_) {}
          warn(info);
        }
        return null;
      }
      // Default place of the NOTES folder: the first entry of the workspace's Pinned tabs (only when it is created;
      // later the person may drag it anywhere and it stays there).
      function zenToTop(el) {
        try {
          if (!prefBool(PREF.ZEN_TOP, true)) return;
          const host = el.parentElement;
          if (!host || zenParentOf(el)) return;
          const first = [...host.children].find((c) => c !== el && /^(zen-folder|tab)$/i.test(c.localName || ""));
          if (first && first !== el && first !== el.nextElementSibling) host.insertBefore(el, first);
        } catch (error) { warn(error); }
      }
      // Entries of ours that are not inside the NOTES folder any more (unpinned, made an Essential, dragged into another
      // folder or window, duplicated, restored): they are only placeholders, so they are closed and the next step puts
      // a fresh one where it belongs. A note is never touched: it lives in the notes folder on disk, not in a tab.
      function zenSweepStrays() {
        const root = zenRootEl();
        if (!root) return;
        for (const t of [...(document.querySelectorAll?.("tab[" + NOTES_ATTR + "]") || [])]) if (!root.contains(t)) zenRemoveTab(t);
        for (const t of [...(document.querySelectorAll?.("tab:not([" + NOTES_ATTR + "])") || [])]) if (zenLooksOurs(t)) zenRemoveTab(t);
        for (const f of [...(document.querySelectorAll?.("zen-folder[bgalazka-notes-subfolder]") || [])]) if (!root.contains(f) && f !== root) { try { f.delete?.(); } catch (_) {} }
      }
      // Entries in browser order, direct children of one folder together (what orderPlan compares).
      const zenElFor = (root, key) => (key.startsWith("f:") ? zenFolderByKey(root, key) : zenByKey(root, key)[0] || null);
      function zenReorder(parentKey, keys) {
        const root = zenRootEl();
        const parentEl = parentKey ? zenFolderByKey(root, parentKey) : root;
        if (!parentEl) return true; // nothing to order yet; a later run will
        const els = keys.map((k) => zenElFor(root, k)).filter((el) => el && (zenParentOf(el) === parentEl || (!parentKey && el.localName === "tab" && el.closest("zen-folder") === parentEl)));
        if (els.length < 2) return true;
        const host = els[0].parentElement;
        if (!host || els.some((el) => el.parentElement !== host)) return false;
        const managed = new Set(els);
        const nowOrder = () => [...host.children].filter((c) => managed.has(c));
        for (let i = 0; i < els.length; i++) {
          const cur = nowOrder();
          if (cur[i] === els[i]) continue;
          // Zen/Firefox's own move first (keeps the browser's state in step), the plain DOM insert as the fallback.
          try { window.gBrowser.moveTabBefore?.(els[i], cur[i]); } catch (_) {}
          if (nowOrder()[i] !== els[i]) { try { host.insertBefore(els[i], cur[i]); } catch (_) {} }
          if (nowOrder()[i] !== els[i]) return false;
        }
        return true;
      }
      const zenApi = {
        busy(on) { zenBusy = on; if (!on) zenQuietUntil = Date.now() + 500; },
        sweepStrays: zenSweepStrays,
        reorder: zenReorder,
        ready: () => !zenMoveBroken && !!(window.gBrowser && window.gZenFolders?.createFolder),
        hasRoot: () => !!zenRootEl(),
        ensureRoot() {
          zenSweepStale();
          if (zenRootEl()) return true;
          const tab = zenNewTab(zenNewUrl(""), "root");
          let folder = null;
          try {
            folder = window.gZenFolders.createFolder([tab], { id: ZEN_ROOT_ID, label: "NOTES", renameFolder: false, collapsed: false, workspaceId: window.gZenWorkspaces?.activeWorkspace });
          } catch (error) { warn(error); }
          const el = (folder && folder.nodeType ? folder : null) || document.getElementById(ZEN_ROOT_ID) || tab.closest?.("zen-folder");
          if (!el) return false; // the tab stays an inert pinned about:blank tab; a later run retries once more
          el.setAttribute("bgalazka-notes-folder", "true");
          zenToTop(el);
          zenSettleSeed(tab, el);
          return !zenKeepSeed || !!zenRootEl();
        },
        list() {
          const root = zenRootEl();
          const out = [];
          // The parent counts as "where it really is": an entry that is not inside the folder it belongs to
          // reports a wrong parent, so the plan moves it (removed now, created again in the right folder).
          const placed = (el, parentKey) => {
            const want = parentKey ? zenFolderByKey(root, parentKey) : root;
            return !want || zenParentOf(el) === want || (!parentKey && el.closest?.("zen-folder") === root) ? parentKey : "?misplaced";
          };
          // One pass in document order, so the result also tells the real order of the entries in the sidebar.
          for (const el of root?.querySelectorAll?.("tab, zen-folder[bgalazka-notes-subfolder]") || []) {
            if (el.localName === "tab") {
              const k = el.getAttribute(NOTES_ATTR) || "";
              if (!k.startsWith("n:")) continue;
              const pk = el.getAttribute("bgalazka-notes-parent") || "";
              const want = pk ? zenFolderByKey(root, pk) : root;
              // The tab's real label: when the browser rewrote it (a discard, a title update) the entry is relabelled.
              out.push({ key: k, label: el.getAttribute("label") || el.getAttribute("bgalazka-notes-label") || "", parent: !want || el.closest?.("zen-folder") === want ? pk : "?misplaced" });
            } else out.push({ key: el.getAttribute("bgalazka-notes-subfolder"), label: el.getAttribute("bgalazka-notes-label") || "", parent: placed(el, el.getAttribute("bgalazka-notes-parent") || "") });
          }
          return out;
        },
        add(e, url) {
          const root = zenRootEl();
          if (!root) return false;
          const parentEl = e.parent ? zenFolderByKey(root, e.parent) : root;
          if (!parentEl) return false;
          if (e.kind === "note") {
            const tab = zenNewTab(url, e.key);
            if (!zenPlace(tab, parentEl)) { zenRemoveTab(tab); zenMoveBroken = true; warn("Zen folder: could not put a tab into the NOTES folder; experiment stopped"); return false; }
            tab.setAttribute("bgalazka-notes-label", e.label);
            tab.setAttribute("bgalazka-notes-parent", e.parent);
            tab.setAttribute("label", e.label);
            return true;
          }
          const made = zenMakeSubfolder(e, parentEl);
          if (!made) return false; // nesting not available: the controller switches to path labels
          const { el, seed } = made;
          el.setAttribute("bgalazka-notes-subfolder", e.key);
          el.setAttribute("bgalazka-notes-label", e.label);
          el.setAttribute("bgalazka-notes-parent", e.parent);
          zenSettleSeed(seed, el);
          return !zenKeepSeed || !!el.isConnected;
        },
        remove(key, dup) {
          const root = zenRootEl();
          const tabs = zenByKey(root, key);
          for (const t of dup ? tabs.slice(1) : tabs) zenRemoveTab(t);
          const f = dup ? null : zenFolderByKey(root, key);
          if (f) { for (const t of [...f.querySelectorAll("tab")]) if (t.hasAttribute(NOTES_ATTR)) zenRemoveTab(t); try { f.delete?.(); } catch (_) {} }
        },
        relabel(key, label) {
          const root = zenRootEl();
          for (const t of zenByKey(root, key)) { t.setAttribute("bgalazka-notes-label", label); t.setAttribute("label", label); }
          const f = zenFolderByKey(root, key);
          if (f) { f.setAttribute("bgalazka-notes-label", label); try { f.label = label; } catch (_) {} }
        },
        move(key) { zenApi.remove(key, false); }, // removed now, added again by the next run under its new parent
        // One "New note" entry in the root and in every sub-folder (on), or none where the folder has other content (off).
        // An entry that is the only thing keeping a folder alive is never removed.
        syncNewButtons(folders, on) {
          const root = zenRootEl();
          if (!root) return;
          const keep = on || zenKeepSeed;
          const targets = [{ key: "root", id: "", el: root }];
          for (const f of folders) {
            const el = zenFolderByKey(root, f.key);
            if (el) targets.push({ key: "new:" + f.id, id: f.id, el });
          }
          for (const t of targets) {
            const inside = [...t.el.querySelectorAll("tab")].filter((x) => x.closest("zen-folder") === t.el);
            const seeds = inside.filter((x) => /^(root|new:)/.test(x.getAttribute(NOTES_ATTR) || ""));
            if (keep) {
              for (const extra of seeds.slice(1)) zenRemoveTab(extra);
              let seed = seeds[0];
              if (!seed) {
                seed = zenNewTab(zenNewUrl(t.id), t.key);
                if (!zenPlace(seed, t.el)) { zenRemoveTab(seed); continue; }
              }
              seed.setAttribute("bgalazka-notes-label", "New note");
              seed.setAttribute("label", "New note");
            } else if (seeds.length && inside.length > seeds.length) {
              for (const sd of seeds) zenRemoveTab(sd);
            }
          }
        },
        // Removes everything this feature ever made, wherever it ended up: marked tabs anywhere, then its sub-folders
        // and the root folder. Only elements carrying our own marks are touched.
        removeAll() {
          const root = zenRootEl();
          for (const t of [...(document.querySelectorAll?.("tab[" + NOTES_ATTR + "]") || [])]) zenRemoveTab(t);
          for (const f of [...(root?.querySelectorAll?.("zen-folder[bgalazka-notes-subfolder]") || [])]) { try { f.delete?.(); } catch (_) {} }
          try { root?.delete?.(); } catch (_) {}
          for (const f of [...(document.querySelectorAll?.('zen-folder[bgalazka-notes-folder="true"]') || [])]) { try { f.delete?.(); } catch (_) {} }
        },
      };
      const makeZen = () =>
        createZenFolder({
          api: zenApi,
          store,
          getMode: zenMode,
          getOrder: () => cleanTreeOrder(prefStr(PREF.TREE_ORDER, "folders-first")),
          getNewButtons: () => zenWantsSeed(),
          setTimer: (fn, ms) => window.setTimeout(fn, ms),
          clearTimer: (id) => window.clearTimeout(id),
          warn,
          onKill: (error) => warn("Zen sidebar folder switched off after an error: " + (error?.message || error)),
        });
      PERF_ON = prefBool(PREF.DEBUG_PERF, false);
      window.__zentralNotesPerf = PERF; // PERF.report() / PERF.reset() in the Browser Console
      onCleanup(() => { PERF_ON = false; try { delete window.__zentralNotesPerf; } catch (_) {} });
      let zen = makeZen();
      onCleanup(() => zen.destroy());
      const zenSoon = () => {
        if (disposed || zenMode() === "off") return;
        if (zen.dead) zen = makeZen(); // toggling the preference revives it after a kill
        bindZen(true);
        ensureStore().then(() => zen.schedule()).catch(warn);
      };
      const zenUnsub = store.on((ev) => {
        if (ev.type === "change" || ev.type === "tree" || ev.type === "remove" || ev.type === "reset") {
          if (zenMode() !== "off" && !zen.dead) zen.schedule();
        }
      });
      onCleanup(zenUnsub);
      const zenBoot = window.setTimeout(zenSoon, 6000);
      onCleanup(() => window.clearTimeout(zenBoot));
      // A click (or Enter) on one of our tabs opens the note instead of selecting the tab. Capture phase, our tabs only;
      // TabSelect is the second line for keyboard / programmatic selection: it hands the selection straight back.
      function activateZenTab(tab) {
        const key = tab.getAttribute(NOTES_ATTR) || "";
        if (key.startsWith("n:")) {
          // A tab whose note is gone (deleted, trashed, or the notes folder was edited outside) opens nothing:
          // it is a stale entry, so the next run drops it instead of showing an empty or wrong note.
          const id = key.slice(2);
          return ensureStore().then(() => {
            const n = store.get(id);
            if (!n || n.trashed) { zen.touch(); return null; }
            return openReminderNote(id, { zenTab: true });
          }).catch(warn);
        }
        // The folder comes from the tab's own mark (an unloaded about:blank tab has no readable address), then its address.
        const p = key === "root" ? { kind: "new", folder: "" } : key.startsWith("new:") ? { kind: "new", folder: cleanFolder(key.slice(4)) } : parseZenUrl(tabUrl(tab));
        if (p?.kind !== "new") return null;
        const folder = p.folder || (zenMode() === "selected" ? TABBAR_FOLDER : "");
        const b = zenTarget();
        return Promise.resolve(b.open()).then(() => sheetOf(b)?.newNote?.(folder)).catch(warn);
      }
      const onZenMouse = (ev) => {
        if (disposed || zen.dead || zenMode() === "off" || (ev.button !== 0 && ev.button !== 1)) return;
        let tab = null;
        try { tab = ev.target?.closest?.("tab[" + NOTES_ATTR + "]"); } catch (_) {}
        if (!tab || !isOurTab(tab)) return; // anything else (unloaded tabs included) is left completely alone
        ev.preventDefault();
        ev.stopImmediatePropagation();
        // Middle click (close / unload in some setups) and the tab's own close / reset buttons do nothing here:
        // an entry is removed with the context menu or by moving the note, never by closing a placeholder tab.
        if (ev.button === 1) return;
        let inButton = false;
        try { inButton = !!ev.target?.closest?.(".tab-close-button, .tab-reset-button, .tab-reset-pin-button, .tab-icon-overlay"); } catch (_) {}
        if (ev.type === "mousedown" && !inButton) activateZenTab(tab);
      };
      // Things done to our tabs by the user, Zen or an add-on that we do not control. None of them can damage a note
      // (a tab is only a pointer); each one only asks for one coalesced, rate limited repair run.
      //  - closed (X, middle click, Ctrl+Shift+T later, "close all"): the entry comes back, a restored copy is swept;
      //  - unpinned / pinned / moved / made an Essential / dragged out: the stray is closed, a fresh entry made in place;
      //  - discarded (unloaded by hand, by Zen's idle unload or by an add-on for every tab): only the label is repaired,
      //    the tab is already inert, and clicking it still opens the note (the mark lives on the element, not the page).
      function zenHeal(tab) {
        try {
          const label = tab.getAttribute("bgalazka-notes-label");
          if (label && tab.getAttribute("label") !== label) tab.setAttribute("label", label);
          if (tab.getAttribute(NOTES_ATTR) && !tab._zentralNotesUrl) tab._zentralNotesUrl = ZEN_URL_PREFIX + "note:" + encodeURIComponent((tab.getAttribute(NOTES_ATTR) || "").slice(2));
        } catch (_) {}
      }
      const onZenTabEvent = (ev) => {
        if (disposed || zen.dead || zenMode() === "off" || zenEventsIgnored()) return;
        const tab = ev.target;
        if (!tab || tab.localName !== "tab") return;
        const marked = tab.hasAttribute?.(NOTES_ATTR);
        if (ev.type === "TabBrowserDiscarded") { if (marked) zenHeal(tab); return; }
        if (!marked && !(ev.type === "SSTabRestored" && zenLooksOurs(tab))) return; // every other tab: not our business
        if (ev.type === "SSTabRestored") zenChecked.delete(tab);
        zen.touch();
      };
      const ZEN_TAB_EVENTS = ["TabClose", "TabUnpinned", "TabPinned", "TabMove", "TabBrowserDiscarded", "SSTabRestored"];
      // Selecting one of our tabs (keyboard, session, script) hands the selection back to the previous tab. This must
      // NOT happen inside Zen's own TabSelect dispatch: re-selecting from there corrupts the tab switcher, and a
      // pending (unloaded) tab then never loads until the browser restarts. So it is deferred to the next task and
      // skipped unless our tab is still the selected one.
      let zenSelectTimer = 0;
      onCleanup(() => window.clearTimeout(zenSelectTimer));
      const onZenSelect = (ev) => {
        const tab = ev.target;
        if (disposed || zen.dead || zenMode() === "off") return;
        // A copy of one of our tabs that lost its mark (duplicate, "open in a new container", reopened closed tab):
        // it is only a placeholder address, so the next run closes it.
        if (!isOurTab(tab)) { if (!zenEventsIgnored() && zenLooksOurs(tab)) zen.touch(); return; }
        const prev = ev.detail?.previousTab;
        window.clearTimeout(zenSelectTimer);
        zenSelectTimer = window.setTimeout(() => {
          zenSelectTimer = 0;
          try {
            if (disposed || window.gBrowser.selectedTab !== tab) return;
            const back = prev && prev.isConnected && !isOurTab(prev) ? prev : [...window.gBrowser.tabs].find((t) => !isOurTab(t) && !t.hasAttribute(NOTES_ATTR) && !t.hidden);
            if (back) window.gBrowser.selectedTab = back;
            activateZenTab(tab);
          } catch (error) { warn(error); }
        }, 0);
      };
      // Dropping a web tab on the NOTES folder never moves it: it is refused, or captured as a link note (dropDecision).
      const onZenDrop = (ev) => {
        const root = zenRootEl();
        if (disposed || zen.dead || !root || !root.contains?.(ev.target)) return;
        let tab = null;
        try { tab = ev.dataTransfer?.mozGetDataAt?.("application/x-moz-tabbrowser-tab", 0); } catch (_) {}
        if (tab?.hasAttribute?.(NOTES_ATTR)) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (ev.type !== "drop" || !tab) return;
        const d = dropDecision({ tab: { attrs: {}, title: tab.label || "", url: tabUrl(tab) }, intoNotes: true });
        if (d.action === "capture-url") store.create(d.body, zenMode() === "selected" ? TABBAR_FOLDER : "");
      };
      // Right-click menus: our own items are added once; for our targets every native item is hidden with CSS (never removed).
      const ZEN_MENU_ITEMS = [
        ["open", "Open note", (tab) => activateZenTab(tab)],
        ["out", "Remove from sidebar folder", (tab) => { const id = (tab.getAttribute(NOTES_ATTR) || "").slice(2); if (id && zenMode() === "selected") { store.setFolder(id, ""); zen.schedule(0); } }],
        ["trash", "Move note to trash", (tab) => { const id = (tab.getAttribute(NOTES_ATTR) || "").slice(2); if (id) store.trash(id); }],
      ];
      let zenCtxTab = null;
      const onTabMenuShowing = (ev) => {
        const menu = ev.target;
        if (menu?.id !== "tabContextMenu") return;
        const tab = window.TabContextMenu?.contextTab;
        zenCtxTab = isOurTab(tab) && /^n:/.test(tab.getAttribute(NOTES_ATTR)) ? tab : null;
        // Our items exist only for our tabs: for any other tab they are hidden and the native menu is untouched.
        for (const own of menu.querySelectorAll("[zentral-notes-own]")) own.hidden = !zenCtxTab;
        if (!zenCtxTab) document.documentElement.removeAttribute("zentral-notes-ctx");
        if (zenCtxTab && !menu.querySelector("[zentral-notes-own]")) {
          for (const [id, label, fn] of ZEN_MENU_ITEMS) {
            const item = document.createXULElement("menuitem");
            item.setAttribute("label", label);
            item.setAttribute("zentral-notes-own", id);
            item.addEventListener("command", () => zenCtxTab && fn(zenCtxTab));
            menu.append(item);
          }
        }
        if (zenCtxTab) document.documentElement.setAttribute("zentral-notes-ctx", "item");
      };
      const onTabMenuHidden = (ev) => {
        if (ev.target?.id === "tabContextMenu") { document.documentElement.removeAttribute("zentral-notes-ctx"); zenCtxTab = null; }
      };
      // Idle cost: the listeners below exist only while the experiment is on (mode != off).
      let zenBound = false;
      function bindZen(on) {
        if (on === zenBound) return;
        zenBound = on;
        const act = on ? "addEventListener" : "removeEventListener";
        for (const ty of ["mousedown", "click", "mouseup", "auxclick"]) window[act](ty, onZenMouse, true);
        for (const ty of ZEN_TAB_EVENTS) window[act](ty, onZenTabEvent, true);
        window[act]("TabSelect", onZenSelect, true);
        for (const ty of ["dragover", "drop"]) window[act](ty, onZenDrop, true);
        window[act]("popupshowing", onTabMenuShowing, true);
        window[act]("popuphidden", onTabMenuHidden, true);
        if (!on) {
          document.documentElement.removeAttribute("zentral-notes-ctx");
          document.querySelectorAll?.("[zentral-notes-own]").forEach((n) => n.remove());
        }
      }
      onCleanup(() => bindZen(false));
      // Turning the feature off unloads it completely: listeners, pending work, flags, menu leftovers, and every tab and
      // folder it made, even when the sync object was killed or never found its root. Safe to call repeatedly.
      function zenTeardown() {
        bindZen(false);
        window.clearTimeout(zenSelectTimer);
        zenSelectTimer = 0;
        zenCtxTab = null;
        zenMoveBroken = false;
        zenKeepSeed = false;
        zenSwept = false;
        zenDiagDone = false;
        zenBusy = false;
        zenQuietUntil = 0;
        try { zen.destroy(); } catch (_) {}
        try { zenApi.removeAll(); } catch (error) { warn(error); }
        zen = makeZen(); // a fresh, idle sync object for the next time the feature is switched on
      }
      onCleanup(() => zenCtxTab = null);

      // ---- bindings: one per bar, plus the floating card ------------------------
      const bindings = new Map(); // bar element -> binding
      let floating = null;
      let lastUsed = null;
      // Which kind of bar Notes was open on until the USER closed it. Switching to another Zentral panel
      // rebuilds bars (Triple View's second panel gets a new bar), which closes the old sheet without the
      // user asking: this remembers that Notes should come back on the new bar of the same kind.
      let followKind = "";
      let followTries = 0;
      let followTimer = 0;
      onCleanup(() => {
        followKind = "";
        window.clearTimeout(followTimer);
        releaseSlot();
      });
      // Optional dock: the card opens beside the Zen sidebar and the sidebar's bottom
      // row gets a Notes button. Missing sidebar elements simply mean no button.
      let sidebarBtn = null;
      const dockSidebarNow = () => prefBool(PREF.DOCK_SIDEBAR, false);
      function syncSidebarButton() {
        const host =
          enabledNow() && dockSidebarNow()
            ? document.getElementById("zen-sidebar-bottom-buttons")
            : null;
        if (!host) {
          sidebarBtn?.remove();
          sidebarBtn = null;
          return;
        }
        if (!sidebarBtn) {
          sidebarBtn = h("button", {
            type: "button",
            class: "zentral-notes-btn zentral-notes-sidebar-btn",
            title: "Notes",
            "aria-label": "Notes",
            "aria-pressed": floating?.isOpen() ? "true" : "false",
          });
          sidebarBtn.dataset.active = floating?.isOpen() ? "true" : "false";
          sidebarBtn.appendChild(icon("note", 14));
          sidebarBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            Promise.resolve(ensureFloating().toggle()).catch(warn);
          });
          sidebarBtn.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const b = ensureFloating();
            Promise.resolve(b.isOpen() ? true : b.open()).then(() => sheetOf(b)?.quickCaptureToday?.()).catch(warn);
          });
        }
        if (sidebarBtn.parentNode !== host) host.appendChild(sidebarBtn);
      }
      onCleanup(() => {
        sidebarBtn?.remove();
        sidebarBtn = null;
      });
      function createBinding({ el, kind }) {
        const button = h("button", {
          type: "button",
          class: "zentral-notes-btn" + (kind === "primary" ? " zen-toolbar-btn" : ""),
          title: "Notes",
          "aria-label": "Notes",
          "aria-pressed": "false",
        });
        button.appendChild(icon("note", 14));
        const adapter = createBarAdapter({ kind, barEl: el, button, widePercent: () => Math.max(1.3, Math.min(3, prefInt(PREF.WIDE_PERCENT, 200) / 100)) });
        adapter.syncMode?.();
        let sheet = null;
        let strip = null;
        let stripTimer = 0;
        let stripPosSet = false;
        const binding = {
          el,
          kind,
          button,
          adapter,
          sheet: () => sheet,
          isOpen: () => !!sheet?.isOpen(),
          visible: () => el.isConnected && !panelsHidden() && el.getClientRects().length > 0,
          // Triple View: the top bar's Notes is the free-floating window; the bottom bar's goes between the panels.
          toFloating: () => kind === "primary" && document.documentElement.hasAttribute("bgalazka-triple-view"),
          open() {
            if (binding.toFloating()) return ensureFloating().open();
            lastUsed = binding;
            followKind = kind;
            followTries = 0;
            if (!sheet) sheet = createSheet({ store, adapter, env, ensureStore });
            const opened = sheet.open();
            syncAllReveals();
            return opened;
          },
          close: () => sheet?.close(),
          // Strip along the top of the panel's bar: hovering it opens the sheet over the panel. It is thin,
          // sits inside the panel (never at the window's edge, so the browser's own top bar is not
          // triggered) and is only there while the panel is shown and the sheet is closed.
          syncReveal() {
            // ONE hover target for the whole window (Triple View has two bars plus the folded sheet's own band):
            // only the bar Notes would open on gets a strip, and none while a sheet is open or folded anywhere.
            const want = prefBool(PREF.REVEAL_STRIP, false) && !disposed && binding.visible() && !binding.isOpen() && revealWants(binding);
            if (!want) {
              window.clearTimeout(stripTimer);
              strip?.remove();
              strip = null;
              if (stripPosSet) el.style.position = "";
              stripPosSet = false;
              return;
            }
            if (!strip) {
              strip = h("div", { class: "zentral-notes-reveal-strip", "aria-hidden": "true" });
              strip.addEventListener("mouseenter", () => {
                window.clearTimeout(stripTimer);
                stripTimer = window.setTimeout(() => {
                  if (!binding.isOpen()) Promise.resolve(binding.open()).catch(warn);
                }, Math.max(0, Math.min(1000, prefInt(PREF.REVEAL_DELAY, 100))));
              });
              strip.addEventListener("mouseleave", () => window.clearTimeout(stripTimer));
              strip.addEventListener("mousedown", (e) => e.stopPropagation());
            }
            strip.style.height = Math.max(2, Math.min(24, prefInt(PREF.REVEAL_HEIGHT, 10))) + "px";
            if (strip.parentNode !== el) {
              try {
                if (window.getComputedStyle(el).position === "static") {
                  el.style.position = "relative";
                  stripPosSet = true;
                }
              } catch (_) {}
              el.appendChild(strip);
            }
          },
          toggle() {
            if (binding.toFloating()) return ensureFloating().toggle();
            return binding.isOpen() ? binding.close() : binding.open();
          },
          destroy() {
            try {
              sheet?.destroy();
            } catch (_) {}
            sheet = null;
            window.clearTimeout(stripTimer);
            strip?.remove();
            strip = null;
            button.remove();
          },
        };
        adapter.onClosed = (info) => {
          syncAllReveals();
          // Closed by hand: stay closed. Closed because its bar went away: come back on the next bar.
          if (info?.manual) followKind = "";
        };
        button.addEventListener("click", (e) => {
          e.stopPropagation();
          Promise.resolve(binding.toggle()).catch(warn);
        });
        // Right click on the Notes button: quick capture to today's note (opens Notes first when it is closed).
        button.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const target = binding.toFloating() ? ensureFloating() : binding;
          Promise.resolve(target.isOpen() ? true : target.open()).then(() => sheetOf(target)?.quickCaptureToday?.()).catch(warn);
        });
        // The bar's own drag handlers must not start from this button.
        button.addEventListener("mousedown", (e) => e.stopPropagation());
        return binding;
      }
      function discoverBars() {
        const out = [];
        const primary = document.getElementById("zen-app-panel-toolbar");
        if (primary) out.push({ el: primary, kind: "primary" });
        for (const bar of document.querySelectorAll(".bgalazka-super-bar"))
          out.push({ el: bar, kind: bar.closest("#zen-app-panel-slider") ? "triple" : "super" });
        return out;
      }
      function syncBars() {
        syncTimer = 0;
        if (disposed) return;
        syncSidebarButton();
        if (!enabledNow()) {
          for (const b of bindings.values()) b.destroy();
          bindings.clear();
          lastUsed = null; // a destroyed binding must never be picked again (it would open an untracked sheet)
          floating?.close();
          return;
        }
        const found = discoverBars();
        for (const [el, b] of [...bindings]) {
          if (!el.isConnected || !found.some((f) => f.el === el)) {
            b.destroy();
            bindings.delete(el);
            if (lastUsed === b) lastUsed = null;
          }
        }
        const show = prefBool(PREF.SHOW_BUTTON, true);
        for (const f of found) {
          let b = bindings.get(f.el);
          if (!b) {
            b = createBinding(f);
            bindings.set(f.el, b);
          }
          b.button.hidden = !show;
          b.adapter.syncMode?.();
          if (f.el.firstElementChild !== b.button) f.el.insertBefore(b.button, f.el.firstChild);
          if (b.isOpen()) {
            b.adapter.rewatch();
            b.sheet()?.layout();
          }
        }
        syncAllReveals(); // after the loop: which bar owns the strip depends on every bar being known
        maybeRestore();
        maybeFollow();
      }
      const panelRootOpen = () => !!document.getElementById("zen-app-panel-root")?.hasAttribute("open");
      function maybeFollow() {
        if (!followKind || disposed || !enabledNow() || restoreState === "checking") return;
        if ([...bindings.values()].some((b) => b.isOpen())) {
          followTries = 0;
          return;
        }
        if (!panelRootOpen() || panelsHidden()) return;
        const visible = [...bindings.values()].filter((b) => b.visible());
        const kind = followTarget({ want: followKind, kinds: visible.map((b) => b.kind), triple: document.documentElement.hasAttribute("bgalazka-triple-view") });
        const target = kind && visible.find((b) => b.kind === kind);
        if (target?.toFloating?.()) return; // the top bar of Triple View is the floating window: never auto-opened
        if (target) {
          followTries = 0;
          Promise.resolve(target.open()).catch(warn);
          return;
        }
        // The new bar may appear a moment later (the panel is still loading): a few quiet retries, then give up.
        if (followTries < 4 && !followTimer) {
          followTries++;
          followTimer = window.setTimeout(() => {
            followTimer = 0;
            scheduleSync();
          }, 250);
        }
      }
      // "Open on Startup" (a panel setting) also brings Notes back where it was: meta.openIn names the bar kind
      // (primary panel, Triple View bottom bar, Super Pin). One quiet attempt per sync until it has decided.
      let restoreState = prefStr("zen.workspace.bgalazka.open_at_startup", "null") !== "null" ? "pending" : "off";
      function maybeRestore() {
        if (restoreState !== "pending" || disposed || !enabledNow()) return;
        if (!document.getElementById("zen-app-panel-root")?.hasAttribute("open")) return;
        restoreState = "checking";
        Promise.resolve(ensureStore())
          .then(() => {
            const want = store.meta.openIn;
            if (!want) {
              restoreState = "done";
              return null;
            }
            const b = [...bindings.values()].find((x) => x.kind === want && x.visible());
            if (!b) {
              restoreState = "pending"; // e.g. Triple View is not up yet: the next sync tries again
              return null;
            }
            restoreState = "done";
            return b.isOpen() ? null : b.open();
          })
          .catch((error) => {
            restoreState = "done";
            warn(error);
          });
      }
      onCleanup(() => (restoreState = "done"));
      let syncTimer = 0;
      const scheduleSync = () => {
        if (!syncTimer && !disposed) syncTimer = window.setTimeout(syncBars, 60);
      };
      onCleanup(() => window.clearTimeout(syncTimer));

      const isOwnMutation = (records) =>
        records.every((r) =>
          r.type !== "attributes" &&
          [...r.addedNodes, ...r.removedNodes].every(
            (n) => n.nodeType === 1 && n.classList?.contains("zentral-notes-sheet"),
          ),
        );
      const mo = new MutationObserver((records) => {
        if (!isOwnMutation(records)) scheduleSync();
      });
      let observedSlider = null;
      let observedRoot = null;
      let bodyObserved = false;
      function attachObservers() {
        const slider = document.getElementById("zen-app-panel-slider");
        if (slider && slider !== observedSlider) {
          observedSlider = slider;
          mo.observe(slider, { childList: true });
        }
        const panelRoot = document.getElementById("zen-app-panel-root");
        if (panelRoot && panelRoot !== observedRoot) {
          observedRoot = panelRoot;
          mo.observe(panelRoot, { attributes: true, attributeFilter: ["open"] });
        }
        if (!bodyObserved && document.body) {
          bodyObserved = true;
          mo.observe(document.body, { childList: true });
        }
        return !!slider;
      }
      onCleanup(() => mo.disconnect());
      // The panel suite builds its slider after startup: retry for a while.
      let tries = 0;
      let retryTimer = 0;
      const retryTick = () => {
        retryTimer = 0;
        if (disposed) return;
        tries++;
        const ready = attachObservers();
        scheduleSync();
        if (!((ready && tries > 3) || tries > 90))
          retryTimer = window.setTimeout(retryTick, 1000);
      };
      retryTimer = window.setTimeout(retryTick, 1000);
      onCleanup(() => window.clearTimeout(retryTimer));
      attachObservers();
      syncBars();

      // ---- shortcut ----------------------------------------------------------------
      let shortcut = parseShortcut(prefStr(PREF.SHORTCUT, "Alt+Shift+N"));
      // A panel hidden by "hide when not hovered" keeps its bars in the DOM and may keep focus, but
      // the user cannot see it: the shortcut then opens the standalone (floating) sheet as if no
      // panel were open.
      function panelsHidden() {
        const r = document.documentElement;
        return r.hasAttribute("bgalazka-hover-panel-enabled") && r.hasAttribute("bgalazka-hover-panel-hidden");
      }
      // The one bar that carries the reveal strip: the bar used last, else the main panel bar, else the first
      // visible one; nobody while any sheet is open (folded or not), because the strip would open a second one.
      function revealOwner() {
        const list = [...bindings.values()].filter((b) => b.visible());
        if (!list.length || list.some((b) => b.isOpen())) return null;
        if (lastUsed && list.includes(lastUsed)) return lastUsed;
        return list.find((b) => b.kind === "primary") || list[0];
      }
      // Triple View has two bars, each with its own strip (top = free-floating window, bottom = between the panels);
      // otherwise only the owner bar has one. Never while any sheet, including the floating one, is open.
      function revealWants(b) {
        const list = [...bindings.values()].filter((x) => x.visible());
        if (!list.length || list.some((x) => x.isOpen()) || floating?.isOpen()) return false;
        if (document.documentElement.hasAttribute("bgalazka-triple-view") && (b.kind === "primary" || b.kind === "triple")) return true;
        return revealOwner() === b;
      }
      function syncAllReveals() {
        for (const b of bindings.values()) b.syncReveal();
      }
      function pickBinding() {
        const active = document.activeElement;
        if (active && !panelsHidden()) {
          for (const b of bindings.values()) {
            const host = b.adapter.host;
            if (b.el.contains(active) || host?.contains(active)) return b;
          }
        }
        if (lastUsed && [...bindings.values()].includes(lastUsed) && lastUsed.visible()) return lastUsed;
        const primary = [...bindings.values()].find((b) => b.kind === "primary" && b.visible());
        if (primary && document.getElementById("zen-app-panel-root")?.hasAttribute("open")) return primary;
        return ensureFloating();
      }
      function ensureFloating() {
        if (!floating) {
          const adapter = createFloatingAdapter({
            widePercent: () => Math.max(1.3, Math.min(3, prefInt(PREF.WIDE_PERCENT, 200) / 100)),
            docked: () => dockSidebarNow(),
            avoidSidebar: () => prefBool(PREF.AVOID_SIDEBAR, true),
            isTrigger: (t) => !!sidebarBtn && (sidebarBtn === t || sidebarBtn.contains?.(t)),
            onActive: (on) => {
              syncAllReveals();
              if (sidebarBtn) {
                sidebarBtn.dataset.active = on ? "true" : "false";
                sidebarBtn.setAttribute("aria-pressed", on ? "true" : "false");
              }
            },
          });
          const sheet = createSheet({ store, adapter, env, ensureStore });
          floating = {
            adapter,
            sheet,
            isOpen: () => sheet.isOpen(),
            open: () => sheet.open(),
            close: () => sheet.close(),
            toggle: () => sheet.toggle(),
            destroy: () => sheet.destroy(),
            // Dock preference changed while open: move to the new place.
            refresh() {
              if (sheet.isOpen()) {
                sheet.root.dataset.host = dockSidebarNow() ? "dock" : "float";
                sheet.applyState?.();
                sheet.layout();
              }
            },
          };
        }
        return floating;
      }
      function toggleFromShortcut() {
        const open = [...bindings.values(), floating].filter((b) => b?.isOpen());
        if (open.length) {
          open.forEach((b) => b.close());
          return;
        }
        Promise.resolve(pickBinding().open()).catch(warn);
      }
      // Global actions (usable while Notes is closed) come from the same shortcut table as the editor ones.
      let globalCache = { raw: null, list: [] };
      function globalShortcuts() {
        const raw = prefStr(PREF.SHORTCUTS, "");
        if (globalCache.raw !== raw)
          globalCache = {
            raw,
            list: effectiveShortcuts(parseShortcutMap(raw)).filter((x) => SHORTCUT_ACTIONS.find((a) => a.id === x.id)?.global),
          };
        return globalCache.list;
      }
      const sheetOf = (b) => (typeof b.sheet === "function" ? b.sheet() : b.sheet);
      // ---- capture: selected text or page -> note ------------------------------------------
      const captureOpts = () => ({
        date: prefBool(PREF.CAPTURE_DATE, true),
        time: prefBool(PREF.CAPTURE_TIME, false),
        source: prefBool(PREF.CAPTURE_SOURCE, true),
        link: prefBool(PREF.CAPTURE_LINK, true),
        highlight: prefBool(PREF.CAPTURE_HIGHLIGHT, true),
        checkbox: prefBool(PREF.CAPTURE_CHECKBOX, false),
        style: prefStr(PREF.CAPTURE_STYLE, "quote"),
        position: prefStr(PREF.CAPTURE_POSITION, "end"),
      });
      // A short message that disappears by itself (the timer exists only while it is visible).
      let toastEl = null, toastTimer = 0;
      function toast(text) {
        if (disposed) return;
        if (!toastEl) {
          toastEl = h("div", { class: "zentral-notes-toast", role: "status" });
          (document.body || rootEl).appendChild(toastEl);
        }
        toastEl.textContent = text;
        toastEl.dataset.on = "true";
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => { if (toastEl) toastEl.dataset.on = "false"; }, 2200);
      }
      onCleanup(() => { window.clearTimeout(toastTimer); toastEl?.remove(); toastEl = null; });
      function pageInfo(browser) {
        const b = browser || window.gBrowser?.selectedBrowser;
        let url = "";
        try { url = Services.io.createExposableURI(b.currentURI).spec; } catch (_) { url = ""; }
        return { url, title: b?.contentTitle || window.gBrowser?.selectedTab?.label || "" };
      }
      // Selected text of the current tab for the keyboard path (the right-click path gets it from the menu).
      async function readSelection() {
        try {
          const text = await window.gBrowser?.selectedBrowser?.finder?.getActiveSelectionText?.();
          if (text) return String(text);
        } catch (_) {}
        try { return String(document.commandDispatcher?.focusedWindow?.getSelection?.() ?? ""); } catch (_) { return ""; }
      }
      // target: "last" | "new" | "inbox" | { id }. Returns the note id, or "" when nothing was added.
      async function captureInto(target, input) {
        await ensureStore();
        const snippet = buildCapture({ text: input.text, title: input.title, url: input.url, now: Date.now(), opts: captureOpts() });
        if (!snippet) { toast("Nothing to add"); return ""; }
        const position = prefStr(PREF.CAPTURE_POSITION, "end");
        let id = typeof target === "object" ? target.id : "";
        if (target === "inbox") {
          const name = cleanLabel(prefStr(PREF.CAPTURE_INBOX, "Inbox")) || "Inbox";
          id = findInbox(store.list(), name)?.id || "";
          if (!id) { const n = store.create("# " + name + "\n"); store.setLabel(n.id, name); id = n.id; }
        } else if (target === "last") id = store.latestId();
        if (target === "new" || !id || !store.get(id)) id = store.create("").id;
        store.update(id, insertCapture(store.get(id).body, snippet, position), "capture");
        store.setMeta({ lastNoteId: id, recent: pushRecent(store.meta.recent, id) });
        await store.flush();
        toast("Added to \u201c" + (titleOf(store.get(id).body) || "Untitled") + "\u201d");
        if (prefBool(PREF.CAPTURE_OPEN, false)) {
          const b = pickBinding();
          Promise.resolve(b.open()).catch(warn);
        }
        return id;
      }
      async function captureFromShortcut(kind) {
        const page = pageInfo();
        const text = kind === "capturePage" ? "" : await readSelection();
        if (kind !== "capturePage" && !text.trim()) { toast("Select some text first"); return; }
        const pref = prefStr(PREF.CAPTURE_TARGET, "last");
        const target = kind === "captureInbox" ? "inbox" : pref === "new" || pref === "inbox" ? pref : "last";
        await captureInto(target, { text, ...page });
      }
      // Right-click entry in the page menu: Last open note / New note / Inbox / Choose note.
      const CTX_ID = "zentral-notes-capture-menu";
      const ctxMenu = () => document.getElementById("contentAreaContextMenu");
      function onCtxShowing(ev) {
        const menu = ev.target;
        if (menu !== ctxMenu() || ev.defaultPrevented) return;
        document.getElementById(CTX_ID)?.remove();
        if (disposed || !enabledNow() || !prefBool(PREF.CAPTURE_MENU, true)) return;
        const cm = window.gContextMenu;
        const text = cm?.isTextSelected ? String(cm.selectionInfo?.fullText || cm.selectionInfo?.text || "") : "";
        const page = pageInfo(cm?.browser);
        if (!text.trim() && !page.url) return;
        const item = (label, target) => {
          const mi = document.createXULElement("menuitem");
          mi.setAttribute("label", label);
          mi.addEventListener("command", () => captureInto(target, { text, ...page }).catch(warn));
          return mi;
        };
        const m = document.createXULElement("menu");
        m.id = CTX_ID;
        m.setAttribute("label", text.trim() ? "Add selection to note" : "Add page link to note");
        const pop = document.createXULElement("menupopup");
        pop.append(item("Last open note", "last"), item("New note", "new"), item("Inbox", "inbox"));
        const ids = (store.meta.recent || []).filter((x) => store.get(x) && !store.get(x).trashed).slice(0, MAX_RECENT);
        if (ids.length) {
          pop.append(document.createXULElement("menuseparator"));
          for (const rid of ids) pop.append(item(titleOf(store.get(rid).body) || "Untitled", { id: rid }));
        } else ensureStore().catch(warn); // the recent list fills on the next right-click
        m.append(pop);
        const anchor = document.getElementById("context-copy") || document.getElementById("context-searchselect");
        if (anchor) anchor.after(m); else menu.append(m);
      }
      const onCtxHidden = (ev) => { if (ev.target === ctxMenu()) document.getElementById(CTX_ID)?.remove(); };
      ctxMenu()?.addEventListener("popupshowing", onCtxShowing);
      ctxMenu()?.addEventListener("popuphidden", onCtxHidden);
      onCleanup(() => {
        ctxMenu()?.removeEventListener("popupshowing", onCtxShowing);
        ctxMenu()?.removeEventListener("popuphidden", onCtxHidden);
        document.getElementById(CTX_ID)?.remove();
      });
      function runGlobal(id) {
        if (id === "captureQuick" || id === "captureInbox" || id === "capturePage") return captureFromShortcut(id).catch(warn);
        if (id === "openFloating") {
          const f = ensureFloating();
          return Promise.resolve(f.isOpen() ? f.close() : f.open());
        }
        if (id === "quickNew") {
          const b = pickBinding();
          return Promise.resolve(b.open()).then(() => sheetOf(b)?.newNote?.());
        }
      }
      const onKey = (e) => {
        if (disposed || e.repeat || e.isComposing || !enabledNow()) return;
        if (matchesShortcut(e, shortcut)) {
          e.preventDefault();
          e.stopPropagation();
          toggleFromShortcut();
          return;
        }
        if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
        const id = matchShortcutAction(e, globalShortcuts());
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          Promise.resolve(runGlobal(id)).catch(warn);
        }
      };
      window.addEventListener("keydown", onKey, true);
      onCleanup(() => window.removeEventListener("keydown", onKey, true));

      // ---- preferences -----------------------------------------------------------------
      // Typography and wrapping are CSS variables / attributes on the root element, so every open
      // sheet follows a preference change without a registry of sheets and without re-rendering.
      const rootEl = document.documentElement;
      function applyViewPrefs() {
        const size = Math.max(8, Math.min(40, prefInt(PREF.FONT_SIZE, 13)));
        const line = Math.max(100, Math.min(300, prefInt(PREF.LINE_HEIGHT, 160)));
        rootEl.style.setProperty("--zentral-notes-font-size", size + "px");
        rootEl.style.setProperty("--zentral-notes-line-height", String(line / 100));
        rootEl.setAttribute("zentral-notes-wrap", prefBool(PREF.WRAP, true) ? "on" : "off");
        rootEl.setAttribute("zentral-notes-copy", prefBool(PREF.READ_COPY, false) ? "on" : "off");
        rootEl.setAttribute("zentral-notes-theme", normalizeTheme(prefStr(PREF.THEME, "zentral")));
        const look = lookOverrides((k) => (LOOK_NUM_PREFS.has(k) ? String(prefInt(k, -1)) : prefStr(k, "")));
        for (const v of LOOK_VARS) rootEl.style.removeProperty(v);
        for (const [k, v] of Object.entries(look.vars)) rootEl.style.setProperty(k, v);
        if (look.flags.length) rootEl.setAttribute("zentral-notes-ov", look.flags.join(" "));
        else rootEl.removeAttribute("zentral-notes-ov");
      }
      applyViewPrefs();
      onCleanup(() => {
        rootEl.style.removeProperty("--zentral-notes-font-size");
        rootEl.style.removeProperty("--zentral-notes-line-height");
        rootEl.removeAttribute("zentral-notes-wrap");
        rootEl.removeAttribute("zentral-notes-copy");
        rootEl.removeAttribute("zentral-notes-theme");
        rootEl.removeAttribute("zentral-notes-ov");
        for (const v of LOOK_VARS) rootEl.style.removeProperty(v);
      });
      const prefObserver = {
        observe(_s, _t, name) {
          if (disposed) return;
          // READ_PREFS (blank lines, line breaks, Setext) are read on every render of the read view;
          // open sheets draw it again now so the change shows at once.
          if (READ_PREFS.has(name)) {
            for (const b of [...bindings.values(), floating]) b?.sheet?.()?.refreshRead?.();
            floating?.sheet?.refreshRead?.();
          } else if (VIEW_PREFS.has(name)) applyViewPrefs();
          else if (name === PREF.SHORTCUT) shortcut = parseShortcut(prefStr(PREF.SHORTCUT, "Alt+Shift+N"));
          else if (name === PREF.DEBUG_PERF) PERF_ON = prefBool(PREF.DEBUG_PERF, false);
          else if (name === PREF.ZEN_MODE) {
            if (zenMode() === "off") zenTeardown();
            else zenSoon();
          }
          else if (name === PREF.ZEN_NEW_BUTTON) {
            if (zenMode() !== "off") zenSoon(); // entries appear in (or leave) every folder at once
          }
          else if (WINDOW_PREFS.has(name)) {
            // Hover reveal, push page, split windows and the sidebar option: open sheets follow at once.
            for (const b of [...bindings.values(), floating]) {
              const sh = typeof b?.sheet === "function" ? b.sheet() : b?.sheet;
              sh?.applyState?.();
              sh?.layout?.();
              b?.syncReveal?.();
            }
          }
          else if (name === PREF.FOLDER) {
            if (storePromise)
              store
                .switchDir()
                .catch(warn);
          } else if (name === PREF.ENABLED || name === PREF.SHOW_BUTTON) {
            attachObservers();
            syncBars();
            if (name === PREF.ENABLED) enabledNow() ? claimWidget() : releaseWidget();
          } else if (name === PREF.DOCK_SIDEBAR) {
            syncSidebarButton();
            floating?.refresh();
          }
        },
      };
      Services.prefs.addObserver("zen.workspace.zentral.notes.", prefObserver);
      onCleanup(() => {
        try {
          Services.prefs.removeObserver("zen.workspace.zentral.notes.", prefObserver);
        } catch (_) {}
      });

      // ---- "Customize toolbar" button ------------------------------------------------------------------
      // One shared widget definition per application. Its callbacks live in the window that created it, so
      // that window owns it and hands it over when it closes (a closed window's functions must not stay
      // registered). The click is routed to the window the button was pressed in.
      function getCUI() {
        try {
          return globalThis.CustomizableUI || ChromeUtils.importESModule("resource:///modules/CustomizableUI.sys.mjs").CustomizableUI;
        } catch (_) {
          return null;
        }
      }
      const iconUrl = () =>
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="context-stroke" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS.note}"/></svg>`,
        );
      // The icon is an SVG that takes its colours from the button (context-stroke), which only works when the
      // element opts in with -moz-context-properties. A rule in the window covers the toolbar button and the
      // copy in the Customize palette alike (an inline style on one node did neither after a restart).
      function iconStyle(doc) {
        try {
          if (!doc || doc.getElementById("zentral-notes-toolbar-style")) return;
          const st = doc.createElement("style");
          st.id = "zentral-notes-toolbar-style";
          st.textContent = `#${TOOLBAR_WIDGET_ID}{list-style-image:url("${iconUrl()}");-moz-context-properties:fill,stroke;fill:none;stroke:currentColor}`;
          (doc.head || doc.documentElement).appendChild(st);
        } catch (_) {}
      }
      function claimWidget() {
        const cui = getCUI();
        if (!cui || disposed || !enabledNow()) return;
        iconStyle(document); // every window needs the icon rule, not only the owner of the widget
        if (cui.__zentralNotesOwner === windowId) return;
        try {
          if (cui.getWidget?.(TOOLBAR_WIDGET_ID)?.provider) cui.destroyWidget(TOOLBAR_WIDGET_ID);
          cui.createWidget({
            id: TOOLBAR_WIDGET_ID,
            type: "button",
            label: "Notes",
            tooltiptext: "Notes",
            localized: false,
            onCreated(node) {
              iconStyle(node.ownerDocument);
            },
            onCommand(event) {
              const w = event?.target?.ownerGlobal;
              (w?.__zentralNotesToggle || window.__zentralNotesToggle)?.();
            },
          });
          cui.__zentralNotesOwner = windowId;
          // A widget registered after startup is not put back where the user placed it until customize mode
          // runs; place it in every open window now.
          try {
            for (const w of Services.wm.getEnumerator("navigator:browser")) {
              iconStyle(w.document);
              try {
                cui.ensureWidgetPlacedInWindow?.(TOOLBAR_WIDGET_ID, w);
              } catch (_) {}
            }
          } catch (_) {}
        } catch (error) {
          warn(error);
        }
      }
      function releaseWidget() {
        const cui = getCUI();
        if (!cui || cui.__zentralNotesOwner !== windowId) return;
        try {
          cui.destroyWidget(TOOLBAR_WIDGET_ID);
        } catch (_) {}
        cui.__zentralNotesOwner = null;
        try {
          for (const w of Services.wm.getEnumerator("navigator:browser")) if (w !== window && w.__zentralNotesClaimWidget) return w.__zentralNotesClaimWidget();
        } catch (_) {}
      }
      window.__zentralNotesToggle = () => {
        if (!disposed && enabledNow()) toggleFromShortcut();
      };
      window.__zentralNotesClaimWidget = claimWidget;
      claimWidget();
      onCleanup(() => {
        releaseWidget();
        try {
          document.getElementById("zentral-notes-toolbar-style")?.remove();
        } catch (_) {}
        delete window.__zentralNotesToggle;
        delete window.__zentralNotesClaimWidget;
      });

      const api = {
        destroy() {
          if (disposed) return;
          disposed = true;
          const closing = store.close().catch(() => {});
          for (const b of bindings.values()) b.destroy();
          bindings.clear();
          floating?.destroy();
          for (const fn of cleanups.splice(0).reverse()) {
            try {
              fn();
            } catch (_) {}
          }
          return closing;
        },
        toggle: toggleFromShortcut,
      };
      window.addEventListener("unload", () => api.destroy(), { once: true });
      return () => api.destroy();
    }

    if (ZentralRuntime) ZentralRuntime.register({ id: "notes", init: start });
    else standaloneReady(start);
  })();
})();
