"use strict";
/* Part B: links between notes. Pure parsing/resolution/export helpers plus the real sheet code on a fake DOM
 * (link dialog, read pane, missing/trashed targets, backlinks menu). Proves logic only: NOT layout, NOT real
 * Gecko, and it cannot prove "no network" for real Zen; it proves the link path never calls openLink/fetch. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { Ev, El, document, raf } = dom;
const fetches = [];
const win = { document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {}, fetch: (u) => fetches.push(u) };
win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array, queueMicrotask, fetch: (u) => fetches.push(u) });
const c = win.__zentralNotesTestSeam.core;
const J = (x) => JSON.parse(JSON.stringify(x));
const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const n = (id, body, extra = {}) => ({ id, body, updated: 1000, trashed: 0, ...extra });

(async () => {
  await test("noteLinkTarget accepts only relative <id>.md and rejects everything else", () => {
    assert.equal(c.noteLinkTarget("n1abc-0001.md"), "n1abc-0001");
    assert.equal(c.noteLinkTarget("./n1abc-0001.md#top"), "n1abc-0001");
    assert.equal(c.noteLinkTarget("My%20note.md"), "My note");
    for (const bad of ["https://x.org/a.md", "file:///etc/a.md", "javascript:x.md", "/abs/a.md", "\\a.md", "../a.md", "dir/a.md", "a%2Fb.md", "a.txt", "a.MD", "", "%E0%A4%A.md", "..%2F..%2Fa.md", "a..b.md", "C:\\x.md"])
      assert.equal(c.noteLinkTarget(bad), null, bad);
  });
  await test("buildNoteLink escapes labels and ids, and parses back to the same id", () => {
    const md = c.buildNoteLink("My note", "a [b]\nc");
    assert.equal(md, "[a b c](My%20note.md)");
    const [p] = J(c.parseBlocks(md));
    assert.equal(p.c[0].t, "nl");
    assert.equal(p.c[0].id, "My note");
    assert.equal(c.buildNoteLink("n1", "  "), "[note](n1.md)");
  });
  await test("parser: note link becomes an 'nl' node (no href); external and non-note .md links stay links", () => {
    const [p] = J(c.parseBlocks("[A](n1.md) [B](https://x.org/n1.md) [C](sub/n1.md) [D](n1.md \"tip\")"));
    const kinds = p.c.filter((x) => x.t !== "text").map((x) => [x.t, x.id || x.href]);
    assert.deepEqual(kinds[0], ["nl", "n1"]);
    assert.deepEqual(kinds[1], ["a", "https://x.org/n1.md"]);
    assert.equal(p.c.filter((x) => x.t === "a").length, 1, "only the https link is an external link");
    assert.ok(p.c.some((x) => x.t === "text" && x.s.includes("[C](sub/n1.md)")), "a path with a slash stays literal text");
    assert.equal(p.c.filter((x) => x.t === "nl").length, 2);
    assert.equal(p.c.find((x) => x.t === "nl" && x.title).title, "tip");
  });
  await test("wiki shorthand: resolves by title, case-insensitive, alias, code is skipped, unresolved kept/plain", () => {
    const all = [n("n1", "Project plan\nbody"), n("n2", "Other")];
    const res = (t) => c.resolveNoteTitle(all, t);
    assert.equal(c.expandWikiLinks("see [[project PLAN]] and [[Project plan|the plan]]", res), "see [Project plan](n1.md) and [the plan](n1.md)".replace("[Project plan]", "[project PLAN]"));
    assert.equal(c.expandWikiLinks("`[[Project plan]]`", res), "`[[Project plan]]`");
    assert.equal(c.expandWikiLinks("```\n[[Project plan]]\n```\n[[Project plan]]", res), "```\n[[Project plan]]\n```\n[Project plan](n1.md)");
    assert.equal(c.expandWikiLinks("[[Nope]]", res), "[[Nope]]");
    assert.equal(c.expandWikiLinks("[[Nope]] and [[Nope|x]]", res, { unresolved: "text" }), "Nope and x");
    assert.equal(c.expandWikiLinks("a\nb [[Project plan]]\nc", res).split("\n").length, 3, "line count is preserved");
  });
  await test("duplicate titles: newest wins deterministically, flagged ambiguous; trashed notes never resolve", () => {
    const all = [n("a", "Same", { updated: 1 }), n("b", "Same", { updated: 5 }), n("c", "Same", { updated: 9, trashed: 7 })];
    const r = c.resolveNoteTitle(all, "same");
    assert.deepEqual(J(r), { id: "b", ambiguous: true });
    assert.equal(c.resolveNoteTitle(all.slice(2), "Same"), null);
    assert.equal(c.resolveNoteTitle([n("x", "T", { updated: 3 }), n("a", "T", { updated: 3 })], "T").id, "a", "tie -> smaller id");
  });
  await test("identity survives a title rename and a folder move: the link text is id based", () => {
    const body = "see [Old title](n1.md)";
    const renamed = [n("n1", "Brand new title", { folder: "work/x" })];
    assert.deepEqual(J([...c.noteLinksIn(body, () => null)]), ["n1"]);
    assert.ok(c.findBacklinks([...renamed, n("n2", body)], renamed[0]).linked.some((x) => x.id === "n2"));
  });
  await test("backlinks: linked vs unlinked mentions; trashed and self are ignored; code blocks do not count", () => {
    const t = n("t", "Recipes");
    const all = [t, n("a", "x [r](t.md)"), n("b", "I like recipes a lot"), n("c", "```\n[r](t.md)\n```"), n("d", "[[Recipes]]"), n("e", "[r](t.md)", { trashed: 5 }), n("t2", "x")];
    const { linked, mentions } = c.findBacklinks(all, t);
    assert.deepEqual(J(linked.map((x) => x.id).sort()), ["a", "d"]);
    assert.deepEqual(J(mentions.map((x) => x.id).sort()), ["b"]);
  });
  await test("export: [[x]] becomes canonical, links follow exported names, escaping/encoding, code untouched, unknown ids kept", () => {
    const all = [n("n1", "Plan A"), n("n2", "see [[Plan A]] [x](n1.md#h \"t\") [gone](n9.md) `[y](n1.md)`")];
    const names = new Map([["n1", "Plan A.md"], ["n2", "Other note.md"]]);
    const out = c.exportBody(all[1], all, names);
    assert.equal(out, "see [Plan A](Plan%20A.md) [x](Plan%20A.md#h \"t\") [gone](n9.md) `[y](n1.md)`");
    assert.ok(!out.includes("[["), "no wiki syntax leaves the app");
    const [p] = J(c.parseBlocks(out));
    assert.equal(p.c.filter((x) => x.t === "nl")[0].id, "Plan A", "an exported file parses back to a note link");
    assert.equal(c.exportBody(all[1], all), "see [Plan A](n1.md) [x](n1.md#h \"t\") [gone](n9.md) `[y](n1.md)`", "single export keeps ids");
  });
  await test("HTML and text export never contain an address for a note link", () => {
    const html = c.exportHtml("a [L](n1.md) b [E](https://x.org)", {});
    assert.ok(html.includes('class="note-link">L<'));
    assert.ok(!/href="[^"]*n1/.test(html));
    assert.ok(html.includes('href="https://x.org/"'));
    assert.ok(c.exportText("a [L](n1.md)", {}).includes("a L"));
    assert.ok(!c.exportText("a [L](n1.md)", {}).includes("n1.md"));
  });

  // ---- sheet ---------------------------------------------------------------------------------
  const files = new Map();
  const io = { join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(), readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; }, writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }), remove: async (p) => files.delete(p), exists: async (p) => files.has(p), children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/")), stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }), restrict: async () => {} };
  const store = c.createStore({ io, notify() {}, windowId: "t", getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout });
  const calls = [];
  const prefs = new Map();
  const env = { openLink: (u) => calls.push(["link", u]), copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {}, getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), setPref: (k, v) => prefs.set(k, v) };
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  sheet.root.ownerDocument = document;
  const q = (cls) => sheet.root.querySelector(cls);
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  const key = (el, k, extra = {}) => el.dispatchEvent(new Ev("keydown", { key: k, bubbles: true, ...extra }));
  const byTitle = (t) => sheet.root.all().find((e) => e.title === t || e.getAttribute("aria-label") === t);
  await sheet.open(); await flushRaf();
  const target = store.create("Target note\nhello");
  const src = store.create("Source");
  await flushRaf();

  await test("link dialog: toolbar button lists other notes, picks one and inserts a canonical link with the selection as label", async () => {
    sheet.openNoteById(src.id);
    const ta = q(".zn-editor");
    ta.value = "see word here"; ta.selectionStart = 4; ta.selectionEnd = 8; dom.state.activeElement = ta;
    click(byTitle("Link to another note\u2026"));
    const rows = q(".zn-noteset");
    assert.ok(rows, "dialog is open");
    const labels = rows.querySelectorAll("button").map((b) => b.textContent);
    assert.ok(labels.includes("Target note") && !labels.includes("Source"), "own note is not offered: " + labels);
    click(rows.querySelectorAll("button").find((b) => b.textContent === "Target note"));
    assert.equal(ta.value, `see [word](${target.id}.md) here`);
  });
  await test("read pane: note link shows its label, opens the target on click, never calls openLink or fetch", async () => {
    store.update(src.id, `go [Target](${target.id}.md)`);
    const ta = q(".zn-editor"); ta.value = `go [Target](${target.id}.md)`;
    ta.dispatchEvent(new Ev("input", { bubbles: true })); await flushRaf();
    key(q(".zn-read"), "e", { ctrlKey: true }); await flushRaf();
    const a = sheet.root.all().find((e) => e._classes.has("zn-notelink"));
    assert.ok(a, "rendered");
    assert.equal(a.textContent, "Target");
    assert.equal(a.getAttribute("href"), null, "no address at all");
    assert.ok(a.title.startsWith("Note: Target note"));
    click(a); await flushRaf();
    assert.equal(q(".zn-title").textContent, "Target note", "the exact target note is open");
    assert.deepEqual(calls, []); assert.deepEqual(fetches, []);
  });
  await test("renaming the target does not break the link; missing and trashed targets are shown differently", async () => {
    sheet.openNoteById(src.id); await flushRaf();
    if (q(".zn-read").hidden) key(q(".zn-editor"), "e", { ctrlKey: true });
    await flushRaf();
    store.update(target.id, "Renamed completely\nhello"); await flushRaf();
    const a = () => sheet.root.all().find((e) => e._classes.has("zn-notelink"));
    assert.ok(a().title.includes("Renamed completely"), "title looked up by id");
    store.trash(target.id); await flushRaf();
    assert.ok(a()._classes.has("is-trashed") && a().title.startsWith("In the trash"));
    await store.deleteForever(target.id); await flushRaf();
    assert.ok(a()._classes.has("is-missing"), "deleted target");
    assert.equal(a().title, "This note no longer exists");
    const before = q(".zn-title").textContent;
    click(a()); await flushRaf();
    assert.equal(q(".zn-title").textContent, before, "clicking a missing target changes nothing");
  });
  await test("wiki shorthand renders as a note link in the read pane", async () => {
    const t2 = store.create("Wiki target\nx");
    sheet.openNoteById(src.id);
    const ta = q(".zn-editor"); ta.value = "[[Wiki target]] and [[Unknown]]";
    ta.dispatchEvent(new Ev("input", { bubbles: true })); await flushRaf();
    if (q(".zn-read").hidden) key(ta, "e", { ctrlKey: true });
    sheet.refreshRead(); await flushRaf();
    const links = sheet.root.all().filter((e) => e._classes.has("zn-notelink"));
    assert.equal(links.length, 1);
    assert.equal(links[0].dataset.noteId, t2.id);
    assert.ok(q(".zn-read").textContent.includes("[[Unknown]]"), "unresolved shorthand stays visible");
  });
  await test("More menu: 'Notes that link here' lists linking notes", async () => {
    const t3 = store.create("Hub note\nx");
    store.create(`points [h](${t3.id}.md)`);
    sheet.openNoteById(t3.id); await flushRaf();
    click(byTitle("More"));
    click(q(".zn-menu").querySelectorAll("button").find((b) => b.textContent.startsWith("Links & dates")));
    const item = q(".zn-menu").querySelectorAll("button").find((b) => b.textContent.startsWith("Notes that link here"));
    assert.ok(item);
    click(item); await new Promise((r) => setImmediate(r));
    const m = q(".zn-menu");
    assert.ok(m.textContent.includes("Linked from") && m.textContent.includes("points"));
  });
  console.log(`\n${passed} notes link tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
