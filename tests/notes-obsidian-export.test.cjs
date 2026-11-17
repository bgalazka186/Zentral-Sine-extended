"use strict";
/* T1.19b: Obsidian vault export (YAML front matter, [[Note#Heading|alias]], ![[embeds]], callouts, tags, attachments). */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./helpers/fake-dom.cjs");

const notesPath = path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js");
const calPath = path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js");
const flavorsPath = path.resolve(__dirname, "../additional/notes/flavors/ZentralNotesFlavors.js");

const VALID_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const VALID_PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
const BAD_PNG = new TextEncoder().encode("not actually a png");

function loadNotesHarness() {
  const dom = createFakeDom();
  const { Ev, El, document, raf } = dom;
  const calMod = require(calPath);
  const flavorsMod = require(flavorsPath);
  const win = {
    document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": calMod, "notes-flavors": flavorsMod },
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
  vm.runInNewContext(fs.readFileSync(notesPath, "utf8"), {
    window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
    console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set,
    setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array,
    TextEncoder, TextDecoder, queueMicrotask,
  });
  const core = win.__zentralNotesTestSeam.core;
  return { dom, win, document, Ev, El, raf, core };
}

function createMemoryStore(core) {
  const files = new Map();
  const bytesMap = new Map();
  const io = {
    makeDir: async () => {},
    stat: async (p) => {
      if (bytesMap.has(p)) return { size: bytesMap.get(p).length, lastModified: Date.now() };
      if (files.has(p)) return { size: files.get(p).text.length, lastModified: files.get(p).mtime };
      throw new Error("nf");
    },
    removeTree: async (d) => {
      for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k);
      for (const k of [...bytesMap.keys()]) if (k.startsWith(d + "/")) bytesMap.delete(k);
    },
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; },
    writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }),
    readBytes: async (p) => { if (!bytesMap.has(p)) throw new Error("nf"); return bytesMap.get(p); },
    writeBytes: async (p, b) => bytesMap.set(p, b instanceof Uint8Array ? b : new Uint8Array(b)),
    remove: async (p) => { files.delete(p); bytesMap.delete(p); },
    exists: async (p) => files.has(p) || bytesMap.has(p),
    children: async (d) => {
      const prefix = d.endsWith("/") ? d : d + "/";
      const direct = new Set();
      for (const k of [...files.keys(), ...bytesMap.keys()]) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const seg = rest.split("/")[0];
        if (seg) direct.add(prefix + seg);
      }
      return [...direct];
    },
    restrict: async () => {},
  };
  const store = core.createStore({
    io,
    getHistory: () => ({ on: true, keep: 5, minutes: 1, capKB: 512, warnMB: 100 }),
    notify() {},
    windowId: "obsidian-export",
    getDir: async () => "/n",
    getMaxSaveMs: () => 5000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
  return { store, files, bytesMap, io };
}

(async () => {
  let passed = 0;
  const run = async (name, fn) => {
    await fn();
    passed++;
    console.log("ok - " + name);
  };

  const { core, Ev, El, raf, document } = loadNotesHarness();

  await run("pure: planObsidianVaultPaths mirrors folders, disambiguates duplicates, excludes Trash, and sanitizes names", () => {
    assert.equal(typeof core.planObsidianVaultPaths, "function");
    assert.equal(typeof core.buildObsidianFrontMatter, "function");
    assert.equal(typeof core.convertBodyToObsidian, "function");
    assert.equal(typeof core.buildObsidianVaultPlan, "function");

    const folders = [
      { id: "work", label: "Work" },
      { id: "work/projects", label: "Projects: 2026" },
      { id: "personal", label: "Personal" },
    ];
    const notes = [
      { id: "n1", folder: "work/projects", body: "# Sprint Plan\nDetails", updated: 1000 },
      { id: "n2", folder: "work", body: "# Meeting\nWork notes", updated: 2000 },
      { id: "n3", folder: "work", body: "# Meeting\nSecond work meeting", updated: 3000 },
      { id: "n4", folder: "personal", body: "# Meeting\nPersonal meeting", updated: 4000 },
      { id: "n5", folder: "daily", body: "# 2026-11-16\nDaily log", updated: 5000 },
      { id: "n6", folder: "", body: "# ..Bad#Title^[1]?\nRoot note", updated: 6000 },
      { id: "n7", folder: "work", body: "# Deleted\nTrashed", trashed: 7000, updated: 7000 },
    ];

    const plan = core.planObsidianVaultPaths(notes, folders);
    assert.equal(plan.entries.length, 6, "trashed note is excluded");
    assert.equal(plan.byId.get("n7"), undefined);

    assert.equal(plan.byId.get("n1").relPath, "Work/Projects_ 2026/Sprint Plan.md");
    assert.equal(plan.byId.get("n1").linkTarget, "Sprint Plan", "unique title gets short wikilink target");

    assert.equal(plan.byId.get("n2").relPath, "Work/Meeting.md");
    assert.equal(plan.byId.get("n3").relPath, "Work/Meeting 2.md", "same-folder duplicate gets numbered suffix");
    assert.equal(plan.byId.get("n4").relPath, "Personal/Meeting.md");
    assert.equal(plan.byId.get("n2").linkTarget, "Work/Meeting", "cross-folder duplicate uses vault-relative wikilink");
    assert.equal(plan.byId.get("n4").linkTarget, "Personal/Meeting", "cross-folder duplicate uses vault-relative wikilink");
    assert.equal(plan.byId.get("n3").linkTarget, "Meeting 2", "unique numbered name stays short");

    assert.equal(plan.byId.get("n5").relPath, "Agenda/2026-11-16.md", "unlabeled daily folder exports as Agenda");
    assert.ok(!/[#^\[\]?]/.test(plan.byId.get("n6").fileName), "forbidden Obsidian filename chars are sanitized");
    assert.ok(!plan.byId.get("n6").fileName.startsWith("."), "filename never starts with dot");
  });

  await run("pure: buildObsidianFrontMatter merges foreign YAML, body front matter, tags and Zentral metadata into one block", () => {
    const note = {
      id: "note-fm-1",
      created: Date.UTC(2026, 10, 10, 9, 0, 0),
      updated: Date.UTC(2026, 10, 16, 12, 30, 0),
      color: "#4a90e2",
      label: "Focus: Q4",
      pinned: true,
      flavor: "obsidian",
      remind: Date.UTC(2026, 10, 20, 8, 0, 0),
      foreign: "aliases:\n  - Launch Doc\ncssclasses: [wide-page]\ntags:\n  - Work/Launch\n  - planning\ncustom_author: Alice",
      body: "---\ntags: [planning, release]\nstatus: active\n---\n# Launch Plan\n\nShip #work/launch and #Release-Notes soon.",
    };

    const res = core.buildObsidianFrontMatter(note);
    assert.equal((res.frontMatter.match(/^---$/gm) || []).length, 2, "exactly one YAML front matter fence pair");
    assert.ok(!res.body.startsWith("---"), "leading body front matter stripped so no duplicate fence remains");
    assert.match(res.frontMatter, /^zentral_id: note-fm-1$/m);
    assert.match(res.frontMatter, /^created: 2026-11-10T09:00:00\.000Z$/m);
    assert.match(res.frontMatter, /^updated: 2026-11-16T12:30:00\.000Z$/m);
    assert.match(res.frontMatter, /^zentral_color: "#4a90e2"$/m);
    assert.match(res.frontMatter, /^zentral_label: "Focus: Q4"$/m);
    assert.match(res.frontMatter, /^zentral_pinned: true$/m);
    assert.match(res.frontMatter, /^zentral_flavor: obsidian$/m);
    assert.match(res.frontMatter, /^zentral_remind: 2026-11-20T08:00:00\.000Z$/m);
    assert.match(res.frontMatter, /aliases:\n  - Launch Doc/, "foreign aliases preserved");
    assert.match(res.frontMatter, /cssclasses: \[wide-page\]/, "foreign cssclasses preserved");
    assert.match(res.frontMatter, /custom_author: Alice/, "custom foreign property preserved");
    assert.match(res.frontMatter, /status: active/, "body front matter property preserved");
    assert.equal((res.frontMatter.match(/^tags:/gm) || []).length, 1, "only one merged tags: key");
    assert.match(res.frontMatter, /  - Work\/Launch\n/, "nested tag preserved without #");
    assert.match(res.frontMatter, /  - planning\n/);
    assert.match(res.frontMatter, /  - release\n/);
    assert.match(res.frontMatter, /  - Release-Notes\n/);
  });

  await run("pure: convertBodyToObsidian maps links, wikilinks, embeds, callouts, highlights, tags and protects code/comments", () => {
    const folders = [{ id: "work", label: "Work" }, { id: "personal", label: "Personal" }];
    const target = {
      id: "sprint-id",
      folder: "work",
      body: "# Sprint Plan\n\n## Risk Register\nWatch deadlines. ^risk1\n",
      updated: 2000,
    };
    const workMeet = { id: "wm-id", folder: "work", body: "# Meeting\n## Agenda\nItems", updated: 2000 };
    const persMeet = { id: "pm-id", folder: "personal", body: "# Meeting\nLunch", updated: 2000 };
    const source = {
      id: "src-id",
      folder: "work",
      updated: 3000,
      body: [
        "# Overview",
        "",
        "## Local Section",
        "Canonical: [Sprint Plan](sprint-id.md) and [Check risks](sprint-id.md#risk-register).",
        "Cross-folder: [Work sync](wm-id.md#agenda) and [[Personal/Meeting|Lunch]].",
        "Wiki: [[Work/Sprint Plan#Risk Register|Risks]], [[#Local Section|Top]], [[Sprint Plan#^risk1|R1]], [[Ghost Page]].",
        "Transclude: ![[Sprint Plan#Risk Register]] and ![[Sprint Plan#^risk1]] and ![[Work/Meeting#Agenda]].",
        "Images: ![Diagram](assets/src-id/diag.png#w=420&a=center), ![Arch|300](assets/src-id/arch.png), ![[shot.png|500]], ![[clip.mp4]].",
        "Attachment: [Spec PDF](assets/src-id/spec.pdf) and remote ![Logo](https://example.com/logo.png).",
        "YouTube: ![[https://youtu.be/dQw4w9WgXcQ]].",
        "",
        "> [!tip]+ Native Callout",
        "> Keep this intact with ==plain highlight== and =={red}colored highlight== and #work/urgent.",
        "",
        ":::warning Watch out",
        "Container callout referencing [Sprint Plan](sprint-id.md).",
        ":::",
        "",
        "%%calendar: Work%%",
        "- 2026-11-16 09:00 Review %%zn-item-id:abc123%%",
        "%%[[Sprint Plan]] and [not a link](sprint-id.md)%%",
        "<!-- [also hidden](sprint-id.md) -->",
        "Inline code: `[Sprint Plan](sprint-id.md)` and `=={red}nope==`.",
        "",
        "```markdown",
        ":::warning Do not convert inside code",
        "[Sprint Plan](sprint-id.md)",
        "![Diagram](assets/src-id/diag.png)",
        ":::",
        "```",
      ].join("\n"),
    };

    const notes = [target, workMeet, persMeet, source];
    const vault = core.buildObsidianVaultPlan(notes, { folders });
    const outFile = vault.files.find((f) => f.noteId === "src-id");
    assert.ok(outFile);
    const md = outFile.text;

    assert.ok(md.includes("Canonical: [[Sprint Plan]] and [[Sprint Plan#Risk Register|Check risks]]."), "canonical links convert to wikilinks with resolved heading text");
    assert.ok(md.includes("Cross-folder: [[Work/Meeting#Agenda|Work sync]] and [[Personal/Meeting|Lunch]]."), "ambiguous cross-folder links use vault-relative paths");
    assert.ok(md.includes("Wiki: [[Sprint Plan#Risk Register|Risks]], [[#Local Section|Top]], [[Sprint Plan#^risk1|R1]], [[Ghost Page]]."), "wikilinks normalize targets and keep aliases/blocks/ghosts");
    assert.ok(md.includes("Transclude: ![[Sprint Plan#Risk Register]] and ![[Sprint Plan#^risk1]] and ![[Work/Meeting#Agenda]]."), "note/section/block embeds resolve to vault targets");
    assert.ok(md.includes("![[diag.png|Diagram|420]]"), "sized Zentral asset image becomes Obsidian embed with width");
    assert.ok(md.includes("![[arch.png|Arch|300]]"), "pipe-sized asset image becomes Obsidian embed");
    assert.ok(md.includes("![[shot.png|500]]"), "bare image transclusion with width preserved");
    assert.ok(md.includes("![[clip.mp4]]"), "bare video transclusion preserved");
    assert.ok(md.includes("[[spec.pdf|Spec PDF]]"), "attached file link becomes Obsidian attachment wikilink");
    assert.ok(md.includes("![Logo](https://example.com/logo.png)"), "remote web image stays standard Markdown");
    assert.ok(md.includes("[YouTube](https://youtu.be/dQw4w9WgXcQ)") && !md.includes("<iframe"), "YouTube embed becomes safe link without iframe");
    assert.ok(md.includes("> [!tip]+ Native Callout"), "native Obsidian callout preserved verbatim");
    assert.ok(md.includes("==plain highlight== and ==colored highlight== and #work/urgent"), "colored highlight becomes Obsidian highlight while plain highlight and tags stay");
    assert.ok(md.includes("> [!warning] Watch out\n> Container callout referencing [[Sprint Plan]]."), "container callout converts to Obsidian callout and converts inner links");
    assert.ok(md.includes("%%calendar: Work%%") && md.includes("%%zn-item-id:abc123%%"), "calendar markers stay intact");
    assert.ok(md.includes("%%[[Sprint Plan]] and [not a link](sprint-id.md)%%"), "Obsidian hidden comments stay untouched");
    assert.ok(md.includes("<!-- [also hidden](sprint-id.md) -->"), "HTML comments stay untouched");
    assert.ok(md.includes("`[Sprint Plan](sprint-id.md)` and `=={red}nope==`"), "inline code stays untouched");
    assert.ok(md.includes(":::warning Do not convert inside code\n[Sprint Plan](sprint-id.md)\n![Diagram](assets/src-id/diag.png)\n:::"), "fenced code stays untouched");
    assert.equal(vault.counts.assets, 5, "all 5 referenced local assets planned");
  });

  await run("store: buildObsidianVault bundles live local notes, deduplicated validated assets, and .obsidian/app.json", async () => {
    const { store, bytesMap } = createMemoryStore(core);
    await store.open();
    const workId = store.addFolder("Work", "");
    const a = store.create("# Alpha\n\n![Photo](assets/placeholder.png)\nSee #alpha");
    const b = store.create("# Beta\n\n![Photo 2](assets/placeholder.png)\nSee [Alpha](" + a.id + ".md)");
    const trashed = store.create("# Trashed Note\nGone");
    store.setFolder(a.id, workId);
    store.setFolder(b.id, workId);
    store.trash(trashed.id);

    // Attach colliding filenames `photo.png` to BOTH notes + one PDF + one corrupted PNG that must be skipped.
    bytesMap.set("/n/assets/" + a.id + "/photo.png", VALID_PNG);
    bytesMap.set("/n/assets/" + a.id + "/bad.png", BAD_PNG);
    bytesMap.set("/n/assets/" + b.id + "/photo.png", VALID_PNG);
    bytesMap.set("/n/assets/" + b.id + "/guide.pdf", VALID_PDF);
    store.update(a.id, "# Alpha\n\n![[photo.png|300]]\n![Bad](assets/" + a.id + "/bad.png)\n#alpha");
    store.update(b.id, "# Beta\n\n![Second](assets/" + b.id + "/photo.png)\n[Guide](assets/" + b.id + "/guide.pdf)\nSee [Alpha](" + a.id + ".md)");
    await store.flush();

    const vault = await store.buildObsidianVault();
    assert.equal(vault.counts.notes, 2, "only live local notes exported (trashed excluded)");
    assert.equal(vault.counts.assets, 3, "two valid colliding PNGs + one PDF bundled; forged bad.png skipped");

    const byPath = new Map(vault.entries.map((e) => [e.path, e]));
    assert.ok(byPath.has(".obsidian/app.json"), "includes .obsidian/app.json");
    const appCfg = JSON.parse(new TextDecoder().decode(byPath.get(".obsidian/app.json").bytes));
    assert.equal(appCfg.attachmentFolderPath, "attachments");
    assert.equal(appCfg.useMarkdownLinks, false);

    assert.ok(byPath.has("Work/Alpha.md"));
    assert.ok(byPath.has("Work/Beta.md"));
    assert.ok(byPath.has("attachments/photo.png"));
    assert.ok(byPath.has("attachments/photo-2.png"), "colliding attachment filename deduplicated");
    assert.ok(byPath.has("attachments/guide.pdf"));
    assert.ok(!byPath.has("attachments/bad.png"), "invalid forged PNG is never exported");

    const alphaMd = new TextDecoder().decode(byPath.get("Work/Alpha.md").bytes);
    const betaMd = new TextDecoder().decode(byPath.get("Work/Beta.md").bytes);
    assert.ok(alphaMd.includes("![[photo.png|300]]"));
    assert.ok(betaMd.includes("![[photo-2.png|Second]]"), "deduplicated attachment name updated in Beta note embed");
    assert.ok(betaMd.includes("[[guide.pdf|Guide]]"));
    assert.ok(betaMd.includes("See [[Alpha]]"));
  });

  await run("UI: More > Import & export exposes Export as Obsidian vault… and invokes env.exportObsidianVault", async () => {
    const { store } = createMemoryStore(core);
    await store.open();
    store.create("# UI Vault Test\nHello #obsidian");
    const calls = [];
    const host = new El("div");
    const adapter = {
      position: "fixed", host, attach: (r) => host.appendChild(r),
      getArea: () => ({ left: 0, top: 0, width: 900, height: 900, anchor: "top" }),
      watch: () => () => {}, setActive() {}, rewatch() {},
    };
    const env = {
      readOpts: () => ({}),
      openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, exportZip: () => 0,
      exportObsidianVault: async (opts) => { calls.push(opts); return { ok: true, counts: { notes: 1, folders: 0, assets: 0 }, written: 2, skipped: 0 }; },
      revealFolder() {}, getPref: (_k, d) => d, setPref() {},
    };
    const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
    sheet.root.ownerDocument = document;
    await sheet.open();
    const flush = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
    await flush();

    const moreBtn = sheet.root.all().find((el) => el.title === "More");
    assert.ok(moreBtn, "More button exists");
    moreBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const importExportItem = sheet.root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.includes("Import & export"));
    assert.ok(importExportItem, "Import & export submenu item exists");
    importExportItem.dispatchEvent(new Ev("pointerenter", { bubbles: false }));
    importExportItem.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const vaultItem = sheet.root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.includes("Export as Obsidian vault"));
    assert.ok(vaultItem, "Export as Obsidian vault… menu item exists");
    vaultItem.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    assert.equal(calls.length, 1, "env.exportObsidianVault invoked");
    sheet.destroy();
  });

  console.log(`notes-obsidian-export: ${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
