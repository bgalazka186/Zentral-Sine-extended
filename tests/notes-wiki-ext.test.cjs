"use strict";
/* T1.10: extended wiki-links. Pure parsing/resolution/export plus the real sheet code on a fake DOM
 * (read pane click, [[ popup for headings and folders). Logic only: NOT layout, NOT real Gecko. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { Ev, El, document, raf } = dom;
const win = { document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array, queueMicrotask });
const c = win.__zentralNotesTestSeam.core;
const J = (x) => JSON.parse(JSON.stringify(x));
const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const n = (id, body, extra = {}) => ({ id, body, updated: 1000, trashed: 0, ...extra });

(async () => {
  await test("parseWikiTarget: title, heading, nested heading, path, same-note", () => {
    assert.deepEqual(J(c.parseWikiTarget("Plan")), { whole: "Plan", path: [], title: "Plan", heading: "", self: false });
    assert.deepEqual(J(c.parseWikiTarget(" Plan # Goals ")), { whole: "Plan", path: [], title: "Plan", heading: "Goals", self: false });
    assert.equal(c.parseWikiTarget("Plan#H1#H2").heading, "H2", "nested: the last part");
    const p = c.parseWikiTarget("Work/Clients/Plan#Goals");
    assert.deepEqual(J([p.path, p.title, p.heading, p.whole]), [["Work", "Clients"], "Plan", "Goals", "Work/Clients/Plan"]);
    const s = c.parseWikiTarget("#Goals");
    assert.deepEqual([s.self, s.title, s.heading], [true, "", "Goals"]);
    assert.equal(c.parseWikiTarget("Plan#").heading, "");
  });
  await test("folderLabels: listed label wins, unlisted folder uses its segment", () => {
    const folders = [{ id: "work", label: "Work stuff" }];
    assert.deepEqual(J(c.folderLabels(folders, "work/clients")), ["Work stuff", "clients"]);
    assert.deepEqual(J(c.folderLabels(folders, "")), []);
  });
  const all = [
    n("p1", "Plan\n# Goals\nx\n## Sub goal\ny\n# Goals\nz", { folder: "work", updated: 5 }),
    n("p2", "Plan\nhome plan", { folder: "home", updated: 9 }),
    n("t1", "TCP/IP\nbody"),
    n("g", "Gone", { trashed: 3 }),
  ];
  const folders = [{ id: "work", label: "Work" }, { id: "home", label: "Home" }];
  await test("resolveWikiTarget: heading by text or slug, repeated headings, missing heading keeps its slug", () => {
    const r = (raw, o) => J(c.resolveWikiTarget(all, folders, c.parseWikiTarget(raw), o));
    assert.deepEqual(r("Work/Plan#goals"), { id: "p1", ambiguous: false, heading: "goals", headingText: "Goals" });
    assert.equal(r("Work/Plan#Sub goal").heading, "sub-goal");
    assert.equal(r("Work/Plan#nope").heading, "nope", "kept so the broken-link check can name it");
    assert.equal(r("Work/Plan").heading, "");
  });
  await test("resolveWikiTarget: folder path picks the right twin; without a path the newest wins and is flagged", () => {
    const r = (raw) => c.resolveWikiTarget(all, folders, c.parseWikiTarget(raw));
    assert.equal(r("Home/Plan").id, "p2");
    assert.equal(r("Work/Plan").id, "p1");
    assert.equal(r("work/PLAN").id, "p1", "case-insensitive");
    assert.deepEqual([r("Plan").id, r("Plan").ambiguous], ["p2", true]);
    assert.equal(r("Elsewhere/Plan"), null, "a path that does not match leaves the link unresolved");
    assert.equal(r("TCP/IP").id, "t1", "a title with a slash is tried whole first");
    assert.equal(r("Gone"), null, "trashed notes never resolve");
  });
  await test("resolveWikiTarget: the Markdown mode can switch the extended forms off", () => {
    const r = (raw, allow) => c.resolveWikiTarget(all, folders, c.parseWikiTarget(raw), { allow });
    assert.equal(r("Work/Plan#Goals", { heading: false }), null);
    assert.equal(r("Work/Plan", { path: false }), null);
    assert.equal(r("Plan", { heading: false, path: false }).id, "p2");
  });
  await test("expandWikiLinks: heading link, heading alias, folder link, label defaults, code skipped, line count kept", () => {
    const res = c.wikiResolver(all, folders);
    assert.equal(c.expandWikiLinks("[[Work/Plan#Goals]]", res), "[Plan > Goals](p1.md#goals)");
    assert.equal(c.expandWikiLinks("[[Work/Plan#Sub goal|the sub]]", res), "[the sub](p1.md#sub-goal)");
    assert.equal(c.expandWikiLinks("[[Home/Plan]]", res), "[Plan](p2.md)");
    assert.equal(c.expandWikiLinks("`[[Work/Plan#Goals]]`", res), "`[[Work/Plan#Goals]]`");
    assert.equal(c.expandWikiLinks("a\n[[Work/Plan#Goals]]\nb", res).split("\n").length, 3);
    assert.equal(c.expandWikiLinks("[[Nope#x]]", res), "[[Nope#x]]");
    assert.equal(c.expandWikiLinks("[[Nope#x]] [[Nope|y]]", res, { unresolved: "text" }), "Nope > x y");
  });
  await test("expandWikiLinks: [[#Heading]] links inside the same note; missing heading stays typed / plain", () => {
    const self = { body: "Title\n# Intro\ntext\n## More here\n" };
    const res = c.wikiResolver(all, folders);
    assert.equal(c.expandWikiLinks("[[#Intro]] and [[#more here|go]]", res, { self }), "[Intro](#intro) and [go](#more-here)");
    assert.equal(c.expandWikiLinks("[[#Nope]]", res, { self }), "[[#Nope]]");
    assert.equal(c.expandWikiLinks("[[#Nope]]", res, { self, unresolved: "text" }), "Nope");
    assert.equal(c.expandWikiLinks("[[#Intro]]", res), "[[#Intro]]", "no note given: left alone");
    assert.equal(c.expandWikiLinks("[[#Intro]]", res, { self, allow: { self: false } }), "[[#Intro]]");
    const [p] = J(c.parseBlocks("[Intro](#intro)"));
    assert.equal(p.c[0].t, "al", "the result is the in-note anchor node");
  });
  await test("the expanded link parses to a note link with a heading", () => {
    const md = c.expandWikiLinks("[[Work/Plan#Goals]]", c.wikiResolver(all, folders));
    const [p] = J(c.parseBlocks(md));
    assert.deepEqual([p.c[0].t, p.c[0].id, p.c[0].heading], ["nl", "p1", "goals"]);
  });
  await test("backlinks and noteLinksIn see heading and folder wiki links", () => {
    const target = all[0];
    const src = n("s", "see [[Work/Plan#Goals|g]]");
    const hit = c.findBacklinks([...all, src], target, folders);
    assert.ok(hit.linked.some((x) => x.id === "s"));
    const other = c.findBacklinks([...all, src], all[1], folders);
    assert.ok(!other.linked.some((x) => x.id === "s"), "the Home plan is not linked");
  });
  await test("export: extended forms leave as canonical links or plain words, never as [[ ]]", () => {
    const note = n("e", "a [[Work/Plan#Goals]] b [[Gone#x]] c [[#Intro]]\n# Intro");
    const out = c.exportBody(note, [...all, note], new Map(), folders);
    assert.equal(out.split("\n")[0], "a [Plan > Goals](p1.md#goals) b Gone > x c [Intro](#intro)");
    assert.ok(!out.includes("[["));
  });
  await test("broken links: wiki link to a missing heading, a missing note and a missing same-note heading", () => {
    const src = n("s", "[[Work/Plan#nope]] [[Work/Plan#Goals]] [[Missing]] [[#Absent]]\n# Here");
    const list = c.findBrokenLinks([...all, src], folders).filter((x) => x.noteId === "s");
    assert.deepEqual(J(list.map((x) => x.kind).sort()), ["missing-heading", "missing-heading", "missing-note"]);
    assert.ok(list.some((x) => x.kind === "missing-heading" && x.targetId === "p1" && x.anchor === "nope"));
    assert.ok(list.some((x) => x.kind === "missing-heading" && x.targetId === "s" && x.anchor === "absent"));
  });
  await test("wikiTrigger: reports the title and the heading part; wikiComplete writes heading and same-note forms", () => {
    const t = c.wikiTrigger("see [[Plan#Go", 13);
    assert.deepEqual([t.title, t.heading, t.query], ["Plan", "Go", "Plan#Go"]);
    assert.equal(c.wikiTrigger("see [[Plan", 10).heading, null);
    assert.equal(c.wikiTrigger("x [[#", 5).title, "");
    const e = c.wikiComplete("see [[Plan#Go", t, 13, "Work/Plan", "Goals");
    assert.equal(e.text, "[[Work/Plan#Goals]]");
    assert.equal(c.wikiComplete("[[#", c.wikiTrigger("[[#", 3), 3, "", "Intro").text, "[[#Intro]]");
    assert.equal(c.wikiComplete("[[Pl", c.wikiTrigger("[[Pl", 4), 4, "Plan").text, "[[Plan]]", "old behaviour");
    assert.equal(c.wikiComplete("[[x", c.wikiTrigger("[[x", 3), 3, "a|b", "c|d#e").text, "[[a/b#c d e]]", "a pipe or # in a heading cannot break the link");
  });

  // ---- sheet ---------------------------------------------------------------------------------
  const files = new Map();
  const io = { join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(), readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; }, writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }), remove: async (p) => { files.delete(p); }, exists: async (p) => files.has(p), makeDir: async () => {}, list: async () => [...files.keys()], stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0, size: (files.get(p)?.text || "").length }) };
  const store = c.createStore({ io, notify() {}, windowId: "t", getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout });
  const prefs = new Map();
  const env = { openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {}, getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), setPref: (k, v) => prefs.set(k, v) };
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  sheet.root.ownerDocument = document;
  const q = (cls) => sheet.root.querySelector(cls);
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  await sheet.open(); await flushRaf();
  const plan = store.create("Plan\n# Intro\nhello\n# Goals\nwin");
  const src = store.create("Source");
  await flushRaf();
  const typeInto = async (ta, text) => { ta.value = text; ta.selectionStart = ta.selectionEnd = text.length; dom.state.activeElement = ta; ta.dispatchEvent(new Ev("input", { bubbles: true })); await flushRaf(); };

  await test("popup: after [[Plan# it lists the headings of that note; picking one writes [[Plan#Goals]]", async () => {
    sheet.openNoteById(src.id); await flushRaf();
    const ta = q(".zn-editor");
    await typeInto(ta, "see [[Plan#");
    const bar = q(".zn-wikibar");
    assert.ok(!bar.hidden, "strip is shown");
    const items = bar.querySelectorAll("button").map((b) => b.textContent);
    assert.deepEqual(J(items), ["# Intro", "# Goals"]);
    await typeInto(ta, "see [[Plan#go");
    assert.deepEqual(J(q(".zn-wikibar").querySelectorAll("button").map((b) => b.textContent)), ["# Goals"], "filtered by what is typed");
    click(q(".zn-wikibar").querySelectorAll("button")[0]); await flushRaf();
    assert.equal(ta.value, "see [[Plan#Goals]]");
  });
  await test("popup: [[# lists the headings of the open note and writes [[#Heading]]", async () => {
    const ta = q(".zn-editor");
    await typeInto(ta, "# Top\ntext\n[[#");
    const items = q(".zn-wikibar").querySelectorAll("button").map((b) => b.textContent);
    assert.deepEqual(J(items), ["# Top"]);
    click(q(".zn-wikibar").querySelectorAll("button")[0]); await flushRaf();
    assert.equal(ta.value, "# Top\ntext\n[[#Top]]");
  });
  await test("popup: a Folder/ prefix narrows the notes and twins are offered with their folder", async () => {
    store.setMeta?.({}); // no-op when absent
    const w = store.create("Twin\nin work", "work");
    const hm = store.create("Twin\nin home", "home");
    await flushRaf();
    const ta = q(".zn-editor");
    await typeInto(ta, "[[Twin");
    const labels = q(".zn-wikibar").querySelectorAll("button").map((b) => b.textContent).sort();
    assert.deepEqual(J(labels), ["home / Twin", "work / Twin"]);
    await typeInto(ta, "[[work/Twin");
    assert.deepEqual(J(q(".zn-wikibar").querySelectorAll("button").map((b) => b.textContent)), ["work / Twin"]);
    click(q(".zn-wikibar").querySelectorAll("button")[0]); await flushRaf();
    assert.equal(ta.value, "[[work/Twin]]");
    assert.ok(w && hm);
  });
  await test("read pane: [[Plan#Goals|win]] is a note link that carries the heading; click opens the note", async () => {
    sheet.openNoteById(src.id); await flushRaf();
    const ta = q(".zn-editor");
    await typeInto(ta, "[[Plan#Goals|win]] [[#Top]]\n# Top");
    if (q(".zn-read").hidden) ta.dispatchEvent(new Ev("keydown", { key: "e", ctrlKey: true, bubbles: true }));
    sheet.refreshRead(); await flushRaf();
    const links = sheet.root.all().filter((e) => e._classes.has("zn-notelink"));
    assert.equal(links.length, 1);
    assert.equal(links[0].textContent, "win");
    assert.equal(links[0].dataset.noteId, plan.id);
    assert.ok(sheet.root.all().some((e) => e._classes.has("zn-anchorlink") && e.textContent === "Top"), "the same-note link is an anchor link");
    click(links[0]); await flushRaf();
    assert.equal(q(".zn-title").textContent, "Plan");
  });
  console.log(`\n${passed} extended wiki-link tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
