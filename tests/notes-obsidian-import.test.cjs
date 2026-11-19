"use strict";

// T1.19c: Obsidian vault import (pure parser/planner, round-trip with T1.19b,
// non-duplicating re-import, asset validation/dedup, and UI dialog flow).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./helpers/fake-dom.cjs");

const ROOT = path.resolve(__dirname, "..");
const FLAVORS_MOD = require(path.join(ROOT, "additional", "notes", "flavors", "ZentralNotesFlavors.js"));
const CAL_MOD = require(path.join(ROOT, "additional", "notes", "calendar", "ZentralNotesCalendar.js"));
const NOTES_SRC = fs.readFileSync(path.join(ROOT, "additional", "notes", "ZentralNotes.uc.js"), "utf8");

function loadNotes() {
  const dom = createFakeDom();
  const { Ev, document, raf } = dom;
  const win = {
    document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": CAL_MOD, "notes-flavors": FLAVORS_MOD },
    requestAnimationFrame: (fn) => raf.push(fn),
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    innerWidth: 1200,
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;
  vm.runInNewContext(NOTES_SRC, {
    window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
    console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set,
    setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array,
    TextEncoder, TextDecoder, queueMicrotask,
  });
  return { seam: win.__zentralNotesTestSeam, window: win, document, dom };
}

function createMemoryStore(core, { nowFn = () => 1700000000000 } = {}) {
  const files = new Map();
  const bytesMap = new Map();
  const dirs = new Set(["/n", "/n/assets", "/n/backup"]);
  const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
  const parentOf = (p) => { const i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : "/"; };
  const io = {
    join,
    filename: (p) => p.split("/").pop(),
    exists: async (p) => dirs.has(p) || files.has(p) || bytesMap.has(p),
    makeDir: async (p) => {
      let cur = "";
      for (const seg of p.split("/").filter(Boolean)) { cur += "/" + seg; dirs.add(cur); }
    },
    children: async (p) => {
      const prefix = p.endsWith("/") ? p : p + "/";
      const out = new Set();
      for (const k of [...dirs, ...files.keys(), ...bytesMap.keys()]) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (!rest) continue;
        out.add(prefix + rest.split("/")[0]);
      }
      return [...out];
    },
    stat: async (p) => {
      if (dirs.has(p)) return { type: "directory", size: 0, lastModified: nowFn() };
      if (files.has(p)) return { type: "regular", size: files.get(p).length, lastModified: nowFn() };
      if (bytesMap.has(p)) return { type: "regular", size: bytesMap.get(p).length, lastModified: nowFn() };
      throw new Error("ENOENT: " + p);
    },
    read: async (p) => { if (!files.has(p)) throw new Error("ENOENT: " + p); return files.get(p); },
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("ENOENT: " + p); return files.get(p); },
    write: async (p, text) => { dirs.add(parentOf(p)); files.set(p, String(text)); },
    writeUTF8: async (p, text) => { dirs.add(parentOf(p)); files.set(p, String(text)); },
    readBytes: async (p) => { if (!bytesMap.has(p)) throw new Error("ENOENT: " + p); return bytesMap.get(p); },
    writeBytes: async (p, bytes) => {
      if (bytesMap.has(p)) { const e = new Error("File exists"); e.name = "NoModificationAllowedError"; throw e; }
      dirs.add(parentOf(p));
      bytesMap.set(p, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    },
    remove: async (p) => { files.delete(p); bytesMap.delete(p); },
    copy: async (src, dst) => {
      dirs.add(parentOf(dst));
      if (files.has(src)) files.set(dst, files.get(src));
      else if (bytesMap.has(src)) bytesMap.set(dst, bytesMap.get(src));
    },
    restrict: async () => {},
  };
  const store = core.createStore({
    io,
    getDir: async () => "/n",
    getMaxSaveMs: () => 5000,
    getHistory: () => ({ on: true, keep: 5, minutes: 1, capKB: 512, warnMB: 100 }),
    notify() {},
    windowId: "obsidian-import",
    now: nowFn,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    warn: () => {},
  });
  return { store, files, bytesMap, dirs, io };
}

const enc = new TextEncoder();
const VALID_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const VALID_PNG_2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const VALID_PDF = enc.encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
const VALID_MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const BAD_PNG = enc.encode("not-a-real-png");

let passed = 0;
async function run(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  const { seam, document, dom } = loadNotes();
  const core = seam.core;

  await run("pure: parseObsidianFrontMatter extracts Zentral metadata, preserves foreign YAML, and stamps obsidian_path once", () => {
    assert.equal(typeof core.parseObsidianFrontMatter, "function", "parseObsidianFrontMatter exported on core");
    const raw = [
      "---",
      "zentral_id: note-rt-1",
      "created: 2026-11-10T09:00:00.000Z",
      "updated: 2026-11-16T12:30:00.000Z",
      'zentral_color: "#4a90e2"',
      'zentral_label: "Focus: Q4"',
      "zentral_pinned: true",
      "zentral_flavor: obsidian",
      "zentral_remind: 2026-11-20T08:00:00.000Z",
      "tags:",
      "  - Work/Launch",
      "  - planning",
      "aliases:",
      "  - Launch Doc",
      "cssclasses: [wide-page]",
      "custom_author: Alice",
      "---",
      "# Launch Plan",
      "",
      "Body text.",
    ].join("\n");

    const parsed = core.parseObsidianFrontMatter(raw, "Work/Launch Plan.md");
    assert.equal(parsed.meta.zentralId, "note-rt-1");
    assert.equal(parsed.meta.created, Date.parse("2026-11-10T09:00:00.000Z"));
    assert.equal(parsed.meta.updated, Date.parse("2026-11-16T12:30:00.000Z"));
    assert.equal(parsed.meta.color, "#4a90e2");
    assert.equal(parsed.meta.label, "Focus: Q4");
    assert.equal(parsed.meta.pinned, true);
    assert.equal(parsed.meta.flavor, "obsidian");
    assert.equal(parsed.meta.remind, Date.parse("2026-11-20T08:00:00.000Z"));
    assert.match(parsed.foreign, /tags:\n  - Work\/Launch\n  - planning/);
    assert.match(parsed.foreign, /aliases:\n  - Launch Doc/);
    assert.match(parsed.foreign, /cssclasses: \[wide-page\]/);
    assert.match(parsed.foreign, /custom_author: Alice/);
    assert.match(parsed.foreign, /obsidian_path: Work\/Launch Plan\.md/);
    assert.doesNotMatch(parsed.foreign, /^zentral_/m, "Zentral export keys are not duplicated in foreign");
    assert.doesNotMatch(parsed.foreign, /^(?:created|updated):/m, "Zentral top-level keys are not duplicated in foreign");
    assert.equal(parsed.body, "# Launch Plan\n\nBody text.");

    // Classify vault entries: ignores .trash, .git, .obsidian plugins, traversal, keeps .obsidian/app.json + md + valid asset extensions
    assert.equal(core.classifyObsidianVaultEntry(".obsidian/app.json")?.kind, "app-config");
    assert.equal(core.classifyObsidianVaultEntry(".obsidian/workspace.json"), null);
    assert.equal(core.classifyObsidianVaultEntry(".trash/Old.md"), null);
    assert.equal(core.classifyObsidianVaultEntry("../escape.md"), null);
    assert.equal(core.classifyObsidianVaultEntry("Work/Launch Plan.md")?.kind, "note");
    assert.equal(core.classifyObsidianVaultEntry("attachments/diag.png")?.kind, "asset");
  });

  await run("pure: planObsidianVaultImport maps folders, converts links/embeds/attachments, prepends missing H1, and skips forged assets", () => {
    assert.equal(typeof core.planObsidianVaultImport, "function", "planObsidianVaultImport exported on core");
    const entries = [
      { path: ".obsidian/app.json", bytes: enc.encode(JSON.stringify({ attachmentFolderPath: "media", useMarkdownLinks: true })), mtime: 5000 },
      { path: ".obsidian/plugins/foo/main.js", bytes: enc.encode("console.log(1)"), mtime: 5000 },
      { path: ".trash/Deleted.md", bytes: enc.encode("# Deleted"), mtime: 5000 },
      { path: "Work/Sprint Plan.md", bytes: enc.encode("# Sprint Plan\n\n## Risk Register\nRisks here ^risk1\n"), mtime: 6000 },
      { path: "Agenda/2026-11-16.md", bytes: enc.encode("# 2026-11-16\n\n- 09:00 Standup\n"), mtime: 6000 },
      { path: "A/B/C/D/E/Deep Note.md", bytes: enc.encode("Deep body without heading.\n"), mtime: 6000 },
      {
        path: "Work/Overview.md",
        mtime: 7000,
        bytes: enc.encode([
          "---",
          "tags: [work/urgent, planning]",
          "aliases: [Main Overview]",
          "---",
          "Intro without H1 heading.",
          "Markdown link: [Sprint Plan](Sprint%20Plan.md) and [Risks](Sprint%20Plan.md#Risk%20Register).",
          "Wikilink: [[Sprint Plan#Risk Register|Check risks]], [[Sprint Plan#^risk1|R1]], [[Ghost Page]].",
          "Embeds: ![[Sprint Plan#Risk Register]], ![[diag.png|Diagram|420]], ![[clip.mp4|480]], ![[spec.pdf]].",
          "Md media: ![Arch|300](../media/arch.png), [Spec Link](../media/spec.pdf), ![Web](https://example.com/a.png).",
          "Forged: ![[forged.png]].",
          "",
          "> [!warning] Watch out",
          "> Keep callout, ==highlight==, #inline/tag, %%hidden [link](Sprint%20Plan.md)%%, <!-- [cm](Sprint%20Plan.md) -->.",
          "",
          "`[not converted](Sprint%20Plan.md)` and `![[diag.png]]`",
          "```md",
          "[code link](Sprint%20Plan.md)",
          "![[diag.png]]",
          "```",
        ].join("\n")),
      },
      { path: "media/diag.png", bytes: VALID_PNG, mtime: 5000 },
      { path: "media/arch.png", bytes: VALID_PNG_2, mtime: 5000 },
      { path: "media/clip.mp4", bytes: VALID_MP4, mtime: 5000 },
      { path: "media/spec.pdf", bytes: VALID_PDF, mtime: 5000 },
      { path: "media/forged.png", bytes: BAD_PNG, mtime: 5000 },
    ];

    let seq = 0;
    const plan = core.planObsidianVaultImport(entries, {
      existingNotes: [],
      existingFolders: [{ id: "work", label: "Work", order: 0, collapsed: false, uid: "f-work" }],
      nowMs: 8000,
      makeIdFn: () => "imp-" + (++seq),
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.counts.create, 4, "4 valid notes planned; .trash and .obsidian plugins ignored");
    assert.equal(plan.counts.invalidAssets, 1, "forged.png rejected by magic-byte validation");

    const sprint = plan.notes.find((n) => n.relPath === "Work/Sprint Plan.md");
    const agenda = plan.notes.find((n) => n.relPath === "Agenda/2026-11-16.md");
    const deep = plan.notes.find((n) => n.relPath === "A/B/C/D/E/Deep Note.md");
    const overview = plan.notes.find((n) => n.relPath === "Work/Overview.md");
    assert.equal(sprint.folder, "work", "reuses existing Work folder id");
    assert.equal(agenda.folder, "daily", "Agenda maps back to built-in daily folder");
    assert.ok(deep.folder.split("/").length <= 4, "folders deeper than FOLDER_MAX_DEPTH are folded safely");
    assert.ok(deep.body.startsWith("# Deep Note\n\nDeep body without heading."), "prepends filename stem as H1 when note lacks heading");
    assert.ok(sprint.body.startsWith("# Sprint Plan\n"), "does not duplicate H1 when note already starts with heading");
    assert.ok(overview.body.startsWith("# Overview\n\nIntro without H1 heading."), "prepends H1 on Overview which lacked heading");

    // Check link, embed, asset and protection conversions
    assert.ok(overview.body.includes("Markdown link: [Sprint Plan](" + sprint.id + ".md) and [Risks](" + sprint.id + ".md#risk-register)."), "relative .md links convert to canonical note links with heading slug");
    assert.ok(overview.body.includes("Wikilink: [[Sprint Plan#Risk Register|Check risks]], [[Sprint Plan#^risk1|R1]], [[Ghost Page]]."), "wikilinks preserved intact");
    assert.ok(overview.body.includes("![[Sprint Plan#Risk Register]]"), "note transclusion preserved");
    assert.ok(overview.body.includes("![Diagram](assets/" + overview.id + "/diag.png#w=420)"), "image embed with alt+width converts to Zentral asset image");
    assert.ok(overview.body.includes("![[clip.mp4|480]]"), "video embed preserved with copied asset");
    assert.ok(overview.body.includes("[spec.pdf](assets/" + overview.id + "/spec.pdf)"), "PDF embed converts to Zentral file attachment link");
    assert.ok(overview.body.includes("![Arch](assets/" + overview.id + "/arch.png#w=300)"), "relative Markdown image with |width converts to Zentral asset image");
    assert.ok(overview.body.includes("[Spec Link](assets/" + overview.id + "/spec.pdf)"), "relative Markdown PDF link reuses deduplicated note asset");
    assert.ok(overview.body.includes("![Web](https://example.com/a.png)"), "remote web image untouched");
    assert.ok(overview.body.includes("> [!warning] Watch out"), "Obsidian callout preserved");
    assert.ok(overview.body.includes("%%hidden [link](Sprint%20Plan.md)%%"), "inline Obsidian comment untouched");
    assert.ok(overview.body.includes("<!-- [cm](Sprint%20Plan.md) -->"), "HTML comment untouched");
    assert.ok(overview.body.includes("`[not converted](Sprint%20Plan.md)` and `![[diag.png]]`"), "inline code untouched");
    assert.ok(overview.body.includes("```md\n[code link](Sprint%20Plan.md)\n![[diag.png]]\n```"), "fenced code untouched");
    assert.equal(plan.assetsToWrite.length, 4, "4 distinct validated assets queued for Overview (spec.pdf deduped, forged.png skipped)");
  });

  await run("store: full round-trip (T1.19b export -> T1.19c import) and idempotent non-duplicating re-import", async () => {
    let clock = Date.parse("2026-11-16T10:00:00.000Z");
    const src = createMemoryStore(core, { nowFn: () => clock });
    await src.store.open();
    const workId = src.store.addFolder("Work", "");
    const a = src.store.create("# Alpha\n\nBody A #work/launch");
    const b = src.store.create("# Beta\n\nSee [Alpha](" + a.id + ".md)");
    src.store.setFolder(a.id, workId);
    src.store.setFolder(b.id, workId);
    src.store.setColor(a.id, "#4a90e2");
    src.store.setLabel(a.id, "Sprint");
    src.store.setPinned(a.id, true);
    src.store.setFlavor(a.id, "obsidian");
    src.bytesMap.set("/n/assets/" + a.id + "/photo.png", VALID_PNG);
    src.bytesMap.set("/n/assets/" + b.id + "/guide.pdf", VALID_PDF);
    src.store.update(a.id, "# Alpha\n\n![Photo](assets/" + a.id + "/photo.png#w=320)\n#work/launch");
    src.store.update(b.id, "# Beta\n\nSee [Alpha](" + a.id + ".md) and [Guide](assets/" + b.id + "/guide.pdf)");
    await src.store.flush();

    const exported = await src.store.buildObsidianVault();
    assert.equal(exported.counts.notes, 2);
    assert.equal(exported.counts.assets, 2);

    // Import exported vault into a brand-new store
    const dst = createMemoryStore(core, { nowFn: () => clock });
    await dst.store.open();
    const first = await dst.store.importObsidianVault(exported.entries, { mode: "merge" });
    assert.equal(first.ok, true);
    assert.equal(first.counts.create, 2);
    assert.equal(first.counts.assets, 2);

    const live1 = dst.store.list();
    assert.equal(live1.length, 2, "2 notes imported into fresh store");
    const impA = dst.store.get(a.id);
    const impB = dst.store.get(b.id);
    assert.ok(impA && impB, "zentral_id preserved on round-trip import");
    assert.equal(impA.color, "#4a90e2");
    assert.equal(impA.label, "Sprint");
    assert.equal(impA.pinned, true);
    assert.equal(impA.flavor, "obsidian");
    assert.ok(dst.bytesMap.has("/n/assets/" + a.id + "/photo.png"), "image asset restored under note folder");
    assert.ok(dst.bytesMap.has("/n/assets/" + b.id + "/guide.pdf"), "PDF asset restored under note folder");
    assert.ok(impA.body.includes("![Photo](assets/" + a.id + "/photo.png#w=320)"), "image link with width round-trips");
    assert.ok(impB.body.includes("[Guide](assets/" + b.id + "/guide.pdf)"), "PDF attachment link round-trips");

    // Re-import the EXACT SAME vault -> ZERO duplicates, ZERO updates, ZERO extra assets!
    const second = await dst.store.importObsidianVault(exported.entries, { mode: "merge" });
    assert.equal(second.ok, true);
    assert.equal(second.counts.create, 0, "re-import creates zero duplicates");
    assert.equal(second.counts.update, 0, "identical re-import performs zero updates");
    assert.equal(second.counts.unchanged, 2, "both notes recognized as unchanged");
    assert.equal(second.counts.assets, 0, "identical existing assets are reused, never duplicated");
    assert.equal(dst.store.list().length, 2, "note count remains 2");

    // Edit Alpha in Obsidian (newer mtime) + add Gamma -> updates Alpha (with backup) and creates Gamma, zero duplicates!
    const editedEntries = exported.entries.map((e) => {
      if (e.path === "Work/Alpha.md") {
        const text = new TextDecoder().decode(e.bytes).replace("#work/launch", "#work/launch\nEdited in Obsidian.");
        return { ...e, bytes: enc.encode(text), mtime: clock + 60000 };
      }
      return e;
    });
    editedEntries.push({ path: "Work/Gamma.md", bytes: enc.encode("# Gamma\n\nBrand new note.\n"), mtime: clock + 60000 });
    const third = await dst.store.importObsidianVault(editedEntries, { mode: "merge" });
    assert.equal(third.ok, true);
    assert.equal(third.counts.create, 1, "new Gamma created");
    assert.equal(third.counts.update, 1, "newer Alpha updated in place");
    assert.equal(third.counts.unchanged, 1, "Beta stays unchanged");
    assert.equal(dst.store.list().length, 3, "total note count is 3 (no duplicates)");
    assert.ok(dst.store.get(a.id).body.includes("Edited in Obsidian."));
    assert.ok([...dst.files.keys()].some((k) => k.startsWith("/n/backup/")), "displaced Alpha backed up before overwrite");

    // Local edit newer than vault mtime: merge keeps local, overwrite applies vault
    clock += 120000;
    dst.store.update(b.id, "# Beta\n\nLocal newer edit.");
    await dst.store.flush();
    const mergeAfterLocal = await dst.store.importObsidianVault(editedEntries, { mode: "merge" });
    assert.equal(mergeAfterLocal.counts.skip, 1, "merge preserves newer local Beta");
    assert.ok(dst.store.get(b.id).body.includes("Local newer edit."));
    const overwriteAfterLocal = await dst.store.importObsidianVault(editedEntries, { mode: "overwrite" });
    assert.equal(overwriteAfterLocal.counts.update, 1, "overwrite applies vault Beta");
    assert.ok(!dst.store.get(b.id).body.includes("Local newer edit."));
  });

  await run("store: external Obsidian vault without zentral_id re-imports without duplicates via obsidian_path", async () => {
    let clock = Date.parse("2026-11-16T11:00:00.000Z");
    const { store } = createMemoryStore(core, { nowFn: () => clock });
    await store.open();
    const vaultV1 = [
      { path: "Projects/Roadmap.md", bytes: enc.encode("---\ntags: [q4]\n---\nInitial roadmap text.\n"), mtime: clock },
      { path: "Inbox.md", bytes: enc.encode("Quick thoughts.\n"), mtime: clock },
    ];
    const r1 = await store.importObsidianVault(vaultV1, { mode: "merge" });
    assert.equal(r1.counts.create, 2);
    assert.equal(store.list().length, 2);
    const roadmapId = r1.createdIds[0];

    // Re-import unchanged -> 0 created, 2 unchanged
    const r2 = await store.importObsidianVault(vaultV1, { mode: "merge" });
    assert.equal(r2.counts.create, 0);
    assert.equal(r2.counts.unchanged, 2);
    assert.equal(store.list().length, 2);

    // Edit content AND add a different H1 title in Obsidian (still no zentral_id) -> matched by obsidian_path!
    const vaultV2 = [
      { path: "Projects/Roadmap.md", bytes: enc.encode("---\ntags: [q4, updated]\n---\n# Renamed Roadmap Heading\n\nUpdated roadmap text.\n"), mtime: clock + 5000 },
      vaultV1[1],
    ];
    const r3 = await store.importObsidianVault(vaultV2, { mode: "merge" });
    assert.equal(r3.counts.create, 0, "external note renamed internally is still matched by obsidian_path");
    assert.equal(r3.counts.update, 1);
    assert.equal(store.list().length, 2);
    assert.ok(store.get(roadmapId).body.includes("Updated roadmap text."));
  });

  await run("UI: More > Import & export exposes Import Obsidian vault… with preview dialog and merge action", async () => {
    const { store } = createMemoryStore(core);
    await store.open();
    const { El, Ev, raf } = dom;
    const sampleVault = [
      { path: "Work/Demo.md", bytes: enc.encode("# Demo\n\nHello Obsidian.\n"), mtime: Date.now() },
    ];
    let picked = 0, importedMode = "";
    const host = new El("div");
    const adapter = {
      position: "fixed", host, attach: (r) => host.appendChild(r),
      getArea: () => ({ left: 0, top: 0, width: 900, height: 900, anchor: "top" }),
      watch: () => () => {}, setActive() {}, rewatch() {},
    };
    const env = {
      openLink: () => {}, copyText: () => {}, exportNote: () => {}, exportAll: () => {}, exportZip: async () => 0,
      exportBackupZip: async () => ({ ok: true, counts: {} }),
      exportObsidianVault: async () => ({ ok: true, counts: {} }),
      pickObsidianVault: async () => { picked++; return { ok: true, folderName: "MyVault", entries: sampleVault }; },
      importObsidianVault: async (entries, opts) => { importedMode = opts?.mode || ""; return store.importObsidianVault(entries, opts); },
      pickBackupZip: async () => null, restoreBackupZip: async () => ({ ok: true }),
      importFolder: async () => 0, printNote: () => {}, exportCalendarWeek: () => {}, printCalendarWeek: () => {},
      revealFolder: () => {}, readOpts: () => ({}), getPref: (_k, d) => d, setPref: () => {},
      loadAsset: async () => null, now: () => Date.now(),
    };
    const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
    sheet.root.ownerDocument = document;
    await sheet.open();
    const flush = async () => { for (let i = 0; i < 6; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
    await flush();

    const moreBtn = sheet.root.all().find((el) => el.title === "More");
    assert.ok(moreBtn, "More button exists");
    moreBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const ieItem = sheet.root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.includes("Import & export"));
    assert.ok(ieItem, "Import & export submenu exists");
    ieItem.dispatchEvent(new Ev("pointerenter", { bubbles: false }));
    ieItem.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const obsImpItem = sheet.root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.includes("Import Obsidian vault"));
    assert.ok(obsImpItem, "Import Obsidian vault… item exists in More > Import & export");
    obsImpItem.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    assert.equal(picked, 1, "env.pickObsidianVault called");

    // Preview dialog should be open with Import / Merge button
    const mergeBtn = sheet.root.querySelectorAll(".zn-dialog button").find((el) => /Import \/ Merge/i.test(el.textContent));
    assert.ok(mergeBtn, "preview dialog shows Import / Merge button");
    mergeBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    assert.equal(importedMode, "merge", "import invoked with merge mode");
    assert.ok(store.list().some((n) => /Hello Obsidian/.test(n.body)), "note imported into store");
    sheet.destroy();
  });

  console.log(`notes-obsidian-import: ${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
