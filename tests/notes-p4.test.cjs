"use strict";
/* P4: roadmap leftovers (heading anchors, footnotes, mentions, hub lists, date notes, version history, [[ completion)
 * and the Zen sidebar folder experiment (controller). Node/fake seams only: the real
 * Zen folder API, Sync and drag/drop are NOT covered (see docs/NOTES-ZEN-FOLDER-BLOCKER.md). */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const win = { document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, { window: win, document: dom.document, Event: dom.Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array, Uint32Array, queueMicrotask });
const c = win.__zentralNotesTestSeam.core;
const J = (x) => JSON.parse(JSON.stringify(x));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const note = (id, body, extra = {}) => ({ id, body, folder: "", updated: 1_700_000_000_000, created: 1, trashed: 0, pinned: false, color: "none", ...extra });

(async () => {
  await test("heading anchors: unique slugs, fences skipped, Polish letters folded, link round trip keeps the heading", () => {
    const hs = c.headingsOf("# Plan\n## Zażółć gęślą\n```\n# not a heading\n```\n## Plan\n### Plan");
    assert.deepEqual(J(hs.map((h) => h.slug)), ["plan", "zazolc-gesla", "plan-1", "plan-2"]);
    assert.equal(c.cleanAnchor("a b"), "");
    assert.deepEqual(J(c.noteLinkParts("n1.md#plan-1")), { id: "n1", heading: "plan-1" });
    assert.deepEqual(J(c.noteLinkParts("n1.md#<script>")), { id: "n1", heading: "" });
    assert.equal(c.noteLinkParts("https://x.org/n1.md#a"), null);
    assert.equal(c.buildNoteLink("n1", "x", "plan-1"), "[x](n1.md#plan-1)");
    assert.equal(c.buildNoteLink("n1", "x", "Bad Slug!"), "[x](n1.md)");
    const [p] = J(c.parseBlocks("[x](n1.md#plan-1)"));
    assert.equal(p.c[0].heading, "plan-1");
    assert.ok(c.headingOffset("a\n## B\nc", "b") === 2);
    assert.ok(c.rewriteNoteLinks("[x](n1.md#h)", new Map([["n1", "A.md"]])).includes("A.md#h"));
  });
  await test("footnotes: numbered by first use, back-matter block, unknown labels stay text, not read as reference links", () => {
    const blocks = J(c.parseBlocks("Text[^b] and[^a] and [^zz] and again[^b].\n\n[^a]: First note.\n[^b]: Second\n    continued.\n\n[ref]: https://x.org"));
    const fn = blocks[0].c.filter((n) => n.t === "fn");
    assert.deepEqual(fn.map((n) => [n.label, n.n]), [["b", 1], ["a", 2], ["b", 1]]);
    assert.ok(blocks[0].c.some((n) => n.t === "text" && n.s.includes("[^zz]")));
    const fb = blocks.find((b) => b.type === "footnotes");
    assert.deepEqual(fb.items.map((i) => i.label), ["b", "a"]);
    assert.equal(c.exportText("x[^1]\n\n[^1]: Note", {}).trim(), "x[1]\n\n[1] Note");
    const html = c.exportHtml("x[^1]\n\n[^1]: Note", {});
    assert.ok(html.includes('id="fnref-1"') && html.includes('<li id="fn-1">Note'));
    assert.ok(!c.parseBlocks("[^1]: orphan").some((b) => b.type === "footnotes"), "a definition nobody uses shows nothing");
    const e = c.insertFootnote("one two\n", 3, 3);
    assert.equal(e.text, "[^1]" + " two" + "\n\n[^1]: ");
    assert.equal(c.nextFootnoteLabel("[^1] [^2]"), "3");
  });
  await test("mentions: whole words only, never inside links or code; linkFirstMention turns exactly one into a link", () => {
    const re = c.mentionRe("Plan");
    assert.ok(c.hasMention("see the plan today", re));
    assert.ok(!c.hasMention("the Planet", re));
    assert.ok(!c.hasMention("a [Plan](n1.md) b `Plan` c [[Plan]] https://x.org/plan", re));
    assert.equal(c.mentionRe("ab"), null);
    assert.equal(c.linkFirstMention("A plan, and the Plan.", "Plan", "n1"), "A [plan](n1.md), and the Plan.");
    assert.equal(c.linkFirstMention("nothing", "Plan", "n1"), null);
    assert.equal(c.linkFirstMention("`plan` only", "Plan", "n1"), null);
    const t = note("t", "Recipes");
    const r = c.findBacklinks([t, note("a", "my recipes list"), note("b", "unrecipesx")], t);
    assert.deepEqual(J(r.mentions.map((x) => x.id)), ["a"]);
  });
  await test("hub list: links with short descriptions, folder scope, no self, trash skipped; bare-link detection", () => {
    const all = [note("n1", "Zeta\nthe last one"), note("n2", "Alpha\nfirst thing", { folder: "work" }), note("n3", "Gone", { trashed: 5 }), note("n4", "Self")];
    assert.equal(c.hubLines(all, { excludeId: "n4" }), "- [Alpha](n2.md) - first thing\n- [Zeta](n1.md) - the last one");
    assert.equal(c.hubLines(all, { folder: "work" }), "- [Alpha](n2.md) - first thing");
    assert.equal(c.hubLines(all, { folder: "" , withDesc: false, excludeId: "n4"}), "- [Zeta](n1.md)");
    const [list] = J(c.parseBlocks("- [Alpha](n2.md) - first thing\n- [Zeta](n1.md)"));
    assert.equal(c.bareNoteLink(list.items[0].c), null, "text after the link: not a bare hub entry");
    assert.equal(c.bareNoteLink(list.items[1].c).id, "n1");
  });
  await test("date notes: today / tomorrow / next work day skip weekends, find and list by date, journal sections", () => {
    const fri = new Date(2026, 10, 6, 15, 0).getTime();
    assert.equal(c.dateTarget("today", fri).ymd, "2026-11-06");
    assert.equal(c.dateTarget("tomorrow", fri).ymd, "2026-11-07");
    assert.equal(c.dateTarget("next", fri).ymd, "2026-11-09", "Friday -> Monday");
    assert.equal(c.dateTarget("next", new Date(2026, 10, 2, 9).getTime()).ymd, "2026-11-03");
    assert.equal(c.parseYmd("2026-02-30"), 0);
    assert.equal(c.parseYmd("1999-01-01"), 0);
    assert.ok(c.parseYmd("2026-11-03") > 0);
    const body = c.dateNoteBody(c.parseYmd("2026-11-03"));
    assert.equal(body, "# 2026-11-03 Tuesday\n\n");
    const all = [note("d1", body, { updated: 5 }), note("d2", "# 2026-11-01 Sunday\n", { updated: 9 }), note("x", "Plain"), note("d3", "# 2026-11-03 Tuesday\nold", { updated: 1 })];
    assert.equal(c.findDateNote(all, "2026-11-03").id, "d1", "newest of equal dates");
    assert.deepEqual(J(c.listDateNotes(all).map((x) => x.ymd)), ["2026-11-03", "2026-11-03", "2026-11-01"]);
    assert.equal(c.listDateNotes(all, { from: "2026-11-02" }).length, 2);
    assert.equal(c.listDateNotes(all, { text: "sunday" }).length, 1);
    const j1 = c.journalSection("# Journal\n", "2026-11-03", c.parseYmd("2026-11-03"));
    assert.ok(j1.created && j1.body.endsWith("## 2026-11-03 Tuesday\n\n") && j1.caret === j1.body.length);
    const j2 = c.journalSection(j1.body + "wrote\n\n## 2026-11-04 Wednesday\n\nlater", "2026-11-03", 0);
    assert.ok(!j2.created && j2.body.slice(0, j2.caret).endsWith("wrote"));
    assert.deepEqual(J(c.journalDays(j2.body)), ["2026-11-03", "2026-11-04"]);
  });
  await test("[[ completion: trigger only inside an open [[, completion eats the closing ]] and strips |", () => {
    assert.deepEqual(J(c.wikiTrigger("see [[Pla", 9)), { start: 4, query: "Pla", title: "Pla", heading: null }); // T1.10 added title and heading
    assert.equal(c.wikiTrigger("see [[Plan]] x", 14), null);
    assert.equal(c.wikiTrigger("[ [x", 4), null);
    const t = c.wikiTrigger("see [[Pla]] z", 9);
    const e = c.wikiComplete("see [[Pla]] z", t, 9, "Plan | b");
    assert.equal(e.text, "[[Plan / b]]");
    assert.equal(e.end, 11);
  });
  await test("history rules: snapshot only when changed, big enough interval, under the cap; prune keeps the newest; options clamp", () => {
    assert.equal(c.shouldSnapshot({ lastMs: 0, now: 5, bytes: 10 }), true);
    assert.equal(c.shouldSnapshot({ lastMs: 1000, now: 1000 + 9 * 60000, bytes: 10, minutes: 10 }), false);
    assert.equal(c.shouldSnapshot({ lastMs: 1000, now: 1000 + 10 * 60000, bytes: 10, minutes: 10 }), true);
    assert.equal(c.shouldSnapshot({ lastMs: 0, now: 5, bytes: 600 * 1024, capKB: 512 }), false);
    assert.equal(c.shouldSnapshot({ lastMs: 0, now: 5, bytes: 10, same: true }), false);
    const names = [1, 2, 3, 4].map((i) => c.historyFileName(Date.UTC(2026, 10, i, 12)));
    assert.deepEqual(J(c.pruneHistory(names.map((name) => ({ name })).concat([{ name: "evil.md" }, { name: "../x.md" }]), 2)), [names[1], names[0]]);
    assert.ok(c.parseHistoryName(names[0]) === Date.UTC(2026, 10, 1, 12));
    assert.equal(c.parseHistoryName("../20261101T120000.md"), 0);
    assert.deepEqual(J(c.historyOptions({ keep: 9999, minutes: 0, capKB: "x", warnMB: 50 })), { keep: 200, minutes: 1, capKB: 512, warnMB: 50 });
    assert.equal(c.historyWarning({ bytes: 1, warnMB: 5 }), "");
    assert.ok(c.historyWarning({ bytes: 6 * 1048576, warnMB: 5 }).includes("6.0 MB"));
  });

  // ---- store: version history on a fake disk ----
  const disk = new Map();
  const lastOpts = new Map();
  const mkio = (failHistory = false) => ({
    join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!disk.has(p)) throw new Error("nf " + p); return disk.get(p).text; },
    writeUTF8: async (p, text, opts) => { lastOpts.set(p, opts); if (failHistory && p.includes("/history/")) throw new Error("disk full"); disk.set(p, { text, mtime: 1 }); },
    remove: async (p) => { disk.delete(p); }, exists: async (p) => disk.has(p),
    children: async (d) => [...new Set([...disk.keys()].filter((k) => k.startsWith(d + "/")).map((k) => d + "/" + k.slice(d.length + 1).split("/")[0]))],
    stat: async (p) => { const e = disk.get(p); if (!e) throw new Error("nf"); return { size: e.text.length, lastModified: 1 }; },
    makeDir: async () => {}, writeBytes: async () => {}, readBytes: async () => new Uint8Array(),
    removeTree: async (d) => { for (const k of [...disk.keys()]) if (k.startsWith(d + "/")) disk.delete(k); },
    restrict: async () => {},
  });
  let clock = Date.UTC(2026, 10, 2, 8, 0, 0);
  const mkstore = (io, hist) => c.createStore({ io, notify() {}, windowId: "t", now: () => clock, getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: () => 0, clearTimer() {}, getHistory: () => hist });
  await test("store history: saves create versions at the interval, prune to N, restore keeps the current text, clear and delete remove them", async () => {
    disk.clear();
    const store = mkstore(mkio(), { on: true, keep: 3, minutes: 10, capKB: 512, warnMB: 100 });
    await store.open();
    const n = store.create("v1");
    await store.flush();
    assert.equal((await store.listHistory(n.id)).length, 1);
    clock += 5 * 60000; store.update(n.id, "v2"); await store.flush();
    assert.equal((await store.listHistory(n.id)).length, 1, "inside the interval: no new version");
    for (const t of ["v3", "v4", "v5", "v6"]) { clock += 11 * 60000; store.update(n.id, t); await store.flush(); }
    const list = await store.listHistory(n.id);
    assert.equal(list.length, 3, "pruned to the newest 3");
    assert.ok(list[0].ms > list[1].ms);
    assert.equal(await store.readVersion(n.id, list[2].name), "v4");
    assert.equal(await store.readVersion(n.id, "../../meta.json"), null, "only history file names are read");
    clock += 60000;
    assert.equal(await store.restoreVersion(n.id, list[2].name), true);
    assert.equal(store.get(n.id).body, "v4");
    const after = await store.listHistory(n.id);
    assert.ok((await Promise.all(after.map((v) => store.readVersion(n.id, v.name)))).includes("v6"), "the text before the restore is kept");
    const usage = await store.historyUsage();
    assert.ok(usage.files >= 3 && usage.bytes > 0);
    await store.clearHistory(n.id);
    assert.equal((await store.listHistory(n.id)).length, 0);
    clock += 11 * 60000; store.update(n.id, "v7"); await store.flush();
    assert.equal((await store.listHistory(n.id)).length, 1);
    await store.deleteForever(n.id);
    assert.ok(![...disk.keys()].some((k) => k.includes("/history/")), "deleting a note deletes its history");
  });
  await test("store history: switched off writes nothing; a failing history disk never fails the note save", async () => {
    disk.clear();
    const off = mkstore(mkio(), { on: false, keep: 5, minutes: 1, capKB: 512, warnMB: 100 });
    await off.open(); const a = off.create("x"); await off.flush();
    assert.ok(![...disk.keys()].some((k) => k.includes("/history/")));
    disk.clear();
    const bad = mkstore(mkio(true), { on: true, keep: 5, minutes: 1, capKB: 512, warnMB: 100 });
    await bad.open(); const b = bad.create("kept"); await bad.flush();
    assert.equal(bad.state.save, "saved");
    assert.ok([...disk.keys()].some((k) => k.endsWith(b.id + ".md")), "note file written");
  });

  await test("Zen projection modes: off shows nothing, selected = only the tabbar folder, all = everything; parents precede children", () => {
    const folders = [{ id: "tabbar", label: "Notes (tabbar)", order: 0, collapsed: false }, { id: "work", label: "Work", order: 1, collapsed: false }];
    const notes = [note("n1", "In bar", { folder: "tabbar" }), note("n2", "Deep", { folder: "tabbar/sub" }), note("n3", "Elsewhere", { folder: "work" }), note("n4", "Root")];
    assert.deepEqual(J(c.projectZen(notes, folders, "off")), []);
    const sel = J(c.projectZen(notes, folders, "selected"));
    assert.deepEqual(sel.map((e) => e.key).sort(), ["f:tabbar/sub", "n:n1", "n:n2"]);
    assert.equal(sel.find((e) => e.key === "n:n1").parent, "", "direct children sit inside the Zen NOTES folder");
    assert.equal(sel.find((e) => e.key === "f:tabbar/sub").parent, "");
    assert.equal(sel.find((e) => e.key === "n:n2").parent, "f:tabbar/sub");
    assert.equal(c.projectZen(notes, [], "selected").length, 3, "without a saved tabbar folder the paths of the notes still build it");
    const all = J(c.projectZen(notes, folders, "all"));
    assert.ok(all.some((e) => e.key === "n:n3") && all.some((e) => e.key === "n:n4"));
    for (const e of all) if (e.parent) assert.ok(all.findIndex((x) => x.key === e.parent) < all.findIndex((x) => x.key === e.key));
    assert.equal(c.projectZen(notes, folders, "bogus").length, 0, "unknown mode = off");
    const many = Array.from({ length: 300 }, (_, i) => note("m" + i, "N" + i));
    assert.equal(c.projectZen(many, [], "all").length, c.ZEN_MAX_ENTRIES);
  });
  await test("Zen tab addresses: only our two shapes parse back; anything else is null", () => {
    assert.deepEqual(J(c.parseZenUrl(c.zenNoteUrl("My note"))), { kind: "note", id: "My note" });
    assert.deepEqual(J(c.parseZenUrl(c.zenNewUrl("work/x"))), { kind: "new", folder: "work/x" });
    for (const bad of ["about:blank", "about:blank#zn-note:../x", "about:blank#zn-note:%E0%A4", "https://x.org#zn-note:a", "about:blank#zn-new:BAD", "", null])
      assert.equal(c.parseZenUrl(bad), null, String(bad));
  });

  // ---- the Zen folder controller against a fake api ----
  function fakeApi({ nesting = true, boom = false } = {}) {
    const items = new Map(); const log = [];
    const api = {
      log, items, rootMade: false, carrierTabs: [],
      ready: () => true, hasRoot: () => api.rootMade,
      ensureRoot() { if (boom) throw new Error("zen exploded"); api.rootMade = true; return true; },
      list: () => [...items.values()].map((e) => ({ key: e.key, label: e.label, parent: e.parent })),
      add(e, url) { if (e.kind === "folder" && !nesting) return false; log.push(["add", e.key]); items.set(e.key, { ...e, url }); return true; },
      remove(key) { log.push(["remove", key]); items.delete(key); },
      relabel(key, label) { log.push(["relabel", key]); items.get(key).label = label; },
      move(key) { log.push(["move", key]); items.delete(key); },
      setUrl(key, url) { log.push(["url", key]); items.get(key).url = url; },
      carriers: () => api.carrierTabs, mark(tab, why) { log.push(["mark", why]); tab.marked = why; }, adopt(tab, key) { log.push(["adopt", key]); tab.adopted = key; },
      removeAll() { log.push(["removeAll"]); items.clear(); api.rootMade = false; },
      buttons: [], syncNewButtons(folders, on) { api.buttons.push({ keys: folders.map((f) => f.key), on }); },
    };
    return api;
  }
  const timers = []; const setT = (fn) => timers.push(fn) ; const flushT = () => { while (timers.length) timers.shift()(); };
  async function zenSetup(opts = {}, mode = "selected", sync = false) {
    disk.clear(); clock = Date.UTC(2026, 10, 2, 8);
    const store = mkstore(mkio(), { on: false });
    await store.open();
    const api = fakeApi(opts);
    const state = { mode, sync, killed: null };
    const zen = c.createZenFolder({ api, store, getMode: () => state.mode, getNewButtons: () => !!state.buttons, now: () => clock, setTimer: setT, clearTimer() {}, warn() {}, onKill: (e) => (state.killed = e) });
    return { store, api, zen, state };
  }
  await test("zen controller: selected mode shows only the tabbar folder; idempotent; rename relabels; move re-adds; never lists foreign keys", async () => {
    const { store, api, zen } = await zenSetup();
    const a = store.create("In bar", "tabbar"); store.create("Elsewhere", "work");
    zen.runNow();
    assert.deepEqual([...api.items.keys()].sort(), ["n:" + a.id]);
    assert.ok(store.meta.folders.some((f) => f.id === "tabbar"), "the reserved folder exists");
    const n = api.log.length; zen.runNow();
    assert.equal(api.log.length, n, "second run: no calls (idempotent)");
    store.update(a.id, "Renamed title"); zen.runNow();
    assert.deepEqual(api.log.slice(n).map((x) => x[0]), ["relabel"]);
    const other = store.create("Moved in", "work"); zen.runNow();
    assert.ok(!api.items.has("n:" + other.id));
    store.setFolder(other.id, "tabbar"); zen.runNow();
    assert.ok(api.items.has("n:" + other.id));
    store.setFolder(other.id, ""); zen.runNow();
    assert.ok(!api.items.has("n:" + other.id), "moved out of the tabbar folder -> removed from the sidebar, the note itself is untouched");
    assert.ok(store.get(other.id));
    for (const e of api.log) assert.ok(/^(add|remove|relabel|move|url|mark|adopt|removeAll)$/.test(e[0]));
  });
  await test("zen controller: whole mode, nested folders and the flat fallback when nesting is refused", async () => {
    const { store, api, zen } = await zenSetup({}, "all");
    store.addFolder("Work"); store.create("Task", "work");
    zen.runNow();
    assert.ok(api.items.has("f:" + store.folderUid("work")) && api.items.has("n:" + store.list()[0].id), "a folder is keyed by its uid, not its path");
    const flat = await zenSetup({ nesting: false }, "all");
    flat.store.addFolder("Work"); const t = flat.store.create("Task", "work");
    flat.zen.runNow();
    assert.equal(flat.zen.flat, true);
    assert.deepEqual([...flat.api.items.keys()], ["n:" + t.id], "folders are not created");
    assert.equal(flat.api.items.get("n:" + t.id).label, "Work / Task", "the path moves into the label");
  });
  await test("zen controller: off removes our entries only; a failure kills it once, keeps notes, and a new controller can start", async () => {
    const z = await zenSetup();
    const a = z.store.create("x", "tabbar"); z.zen.runNow(); assert.equal(z.api.items.size, 1);
    z.state.mode = "off"; z.zen.runNow();
    assert.ok(z.api.log.some((e) => e[0] === "removeAll") && z.api.items.size === 0);
    assert.ok(z.store.get(a.id), "notes untouched");
    const k = await zenSetup({ boom: true });
    k.store.create("y", "tabbar");
    k.zen.runNow();
    assert.ok(k.zen.dead && k.state.killed.message === "zen exploded");
    k.api.log.length = 0; k.zen.schedule(); k.zen.runNow();
    assert.equal(k.api.log.length, 0, "dead controller does nothing");
    assert.equal(k.store.list().length, 1);
  });
  await test("zen controller: schedule coalesces to one timer; destroy cancels", async () => {
    const { zen } = await zenSetup();
    timers.length = 0;
    zen.schedule(); zen.schedule(); zen.schedule();
    assert.equal(timers.length, 1);
    flushT(); zen.destroy(); zen.schedule();
    assert.equal(timers.length, 0);
  });
  await test("zen controller: the New note entries are asked for once per run with every existing folder (root is the api's own)", async () => {
    const z = await zenSetup({}, "all");
    z.state.buttons = true;
    z.store.addFolder("Work"); z.store.addFolder("Deep", "work"); z.store.create("T", "work/deep");
    z.zen.runNow();
    const last = z.api.buttons[z.api.buttons.length - 1];
    assert.equal(last.on, true);
    assert.deepEqual(J(last.keys).sort(), ["f:" + z.store.folderUid("work"), "f:" + z.store.folderUid("work/deep")].sort(), "every sub-folder, nested ones included");
    z.state.buttons = false; z.zen.runNow();
    assert.equal(z.api.buttons[z.api.buttons.length - 1].on, false, "off is passed on so the entries can leave");
  });
  await test("zen controller: an entry that is not inside its folder is moved (removed, then added again in the right place)", async () => {
    const z = await zenSetup({}, "all");
    z.store.addFolder("Work"); const t = z.store.create("T", "work");
    z.zen.runNow();
    const wk = "f:" + z.store.folderUid("work");
    z.api.items.get(wk).parent = "?misplaced"; // what the real list() reports for a folder outside its parent
    z.api.log.length = 0; z.zen.runNow();
    assert.deepEqual(z.api.log.map((e) => e[0] + ":" + e[1]), ["move:" + wk]);
    z.api.log.length = 0; flushT(); // move schedules one follow-up run that creates it again
    assert.ok(z.api.items.has(wk) && z.api.items.has("n:" + t.id));
  });
  await test("zen order: entries follow the sheet's tree order for every tree_order value, parents first", () => {
    const folders = [{ id: "b", label: "Beta", order: 1, collapsed: false }, { id: "a", label: "Alpha", order: 0, collapsed: false }];
    const notes = [note("n1", "Zed", { updated: 5 }), note("n2", "Mid", { folder: "a", updated: 4 }), note("n3", "Apple", { updated: 9 })];
    const keys = (o) => J(c.projectZen(notes, folders, "all", o)).filter((e) => e.parent === "").map((e) => e.key);
    assert.deepEqual(keys("folders-first"), ["f:a", "f:b", "n:n3", "n:n1"], "folders by their order, then notes (newest first)");
    assert.deepEqual(keys("notes-first"), ["n:n3", "n:n1", "f:a", "f:b"]);
    assert.deepEqual(keys("mixed-by-name"), ["f:a", "n:n3", "f:b", "n:n1"], "one alphabetical list: Alpha, Apple, Beta, Zed");
  });
  await test("zen order: orderPlan names only the parents that are out of order and ignores missing keys", () => {
    const want = [{ key: "n:1", parent: "" }, { key: "n:2", parent: "" }, { key: "n:3", parent: "" }, { key: "n:4", parent: "f:x" }, { key: "n:5", parent: "f:x" }];
    assert.deepEqual(J(c.orderPlan(want, want)), []);
    const cur = [{ key: "n:3", parent: "" }, { key: "n:1", parent: "" }, { key: "n:4", parent: "f:x" }, { key: "n:5", parent: "f:x" }];
    assert.deepEqual(J(c.orderPlan(cur, want)), [{ parent: "", keys: ["n:1", "n:3"] }], "n:2 is missing (added elsewhere); f:x is already right");
  });
  await test("zen controller: reorders to the tree order once, stops for good if the browser refuses, never loops", async () => {
    const z = await zenSetup({}, "all");
    const a = z.store.create("Alpha", ""); clock += 1000; const b = z.store.create("Bravo", "");
    const calls = [];
    z.api.list = () => [{ key: "n:" + a.id, label: "Alpha", parent: "" }, { key: "n:" + b.id, label: "Bravo", parent: "" }];
    z.api.items.set("n:" + a.id, { key: "n:" + a.id, label: "Alpha", parent: "" }); z.api.items.set("n:" + b.id, { key: "n:" + b.id, label: "Bravo", parent: "" });
    z.api.reorder = (parent, keys) => { calls.push(keys.join(",")); return false; };
    z.zen.runNow(); z.zen.runNow();
    assert.equal(calls.length, 1, "the first refusal switches reordering off; no retry loop");
    assert.deepEqual(calls[0].split(","), ["n:" + b.id, "n:" + a.id], "newest note first, like the sheet");
    assert.ok(!z.zen.dead, "a refused reorder does not kill the controller");
  });
  await test("zen controller: browser-side requests (touch) are coalesced and rate limited; note-side requests are not", async () => {
    const z = await zenSetup({}, "all");
    timers.length = 0;
    assert.equal(z.zen.touch(), true); assert.equal(z.zen.touch(), true);
    assert.equal(timers.length, 1, "coalesced to one run");
    flushT();
    let accepted = 2;
    for (let i = 0; i < 30; i++) { if (z.zen.touch()) accepted++; flushT(); }
    assert.equal(accepted, 12, "12 a minute, then ignored: an add-on touching every tab cannot start a loop");
    timers.length = 0; z.zen.schedule(); assert.equal(timers.length, 1, "schedule() from the notes is never limited");
    flushT(); clock += 61000; assert.equal(z.zen.touch(), true, "the limit lifts after a minute");
    flushT();
    z.zen.kill(new Error("x")); assert.equal(z.zen.touch(), false, "dead controller ignores everything");
  });
  await test("zen controller: strays are swept before the diff, busy flag brackets every run, even a failing one", async () => {
    const z = await zenSetup({}, "all");
    const seen = []; z.api.sweepStrays = () => seen.push("sweep"); z.api.busy = (on) => seen.push(on ? "busy" : "idle");
    z.store.create("x", ""); z.zen.runNow();
    assert.deepEqual(seen, ["busy", "sweep", "idle"]);
    const k = await zenSetup({ boom: true }, "all"); const s2 = []; k.api.busy = (on) => s2.push(on); k.store.create("y", ""); k.zen.runNow();
    assert.deepEqual(s2, [true, false], "released after the kill switch fired");
  });
  await test("zen tab safety: every user/add-on action on our tabs is wired and scoped (static)", () => {
    const js = require("node:fs").readFileSync(require("node:path").join(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
    assert.match(js, /ZEN_TAB_EVENTS = \["TabClose", "TabUnpinned", "TabPinned", "TabMove", "TabBrowserDiscarded", "SSTabRestored"\]/);
    assert.match(js, /for \(const ty of ZEN_TAB_EVENTS\) window\[act\]\(ty, onZenTabEvent, true\)/, "bound and unbound with the feature");
    assert.match(js, /"auxclick"/, "middle click is intercepted on our tabs");
    assert.match(js, /\.tab-close-button, \.tab-reset-button/, "close / reset buttons on our tabs do not open anything");
    assert.match(js, /if \(!marked && !\(ev\.type === "SSTabRestored" && zenLooksOurs\(tab\)\)\) return;/, "unmarked tabs are ignored");
    assert.match(js, /if \(!n \|\| n\.trashed\) \{ zen\.touch\(\); return null; \}/, "a stale entry opens nothing");
    assert.match(js, /if \(!root\.contains\(t\)\) zenRemoveTab\(t\)/, "marked tabs outside the NOTES folder are closed");
    assert.match(js, /spec\.startsWith\(ZEN_URL_PREFIX\) \? spec : tab\._zentralNotesUrl/, "a discarded tab keeps its address");
  });
  await test("perf sampler: records nothing while off, counts and maxima while on", () => {
    let on = false, t = 0;
    const s = c.createPerfSampler({ enabled: () => on, now: () => t });
    const f = s.wrap("x", function (a) { t += a; return a * 2; });
    assert.equal(f(3), 6); assert.equal(s.report(), "(no samples)");
    on = true; f(2); f(5);
    const [r] = s.rows();
    assert.deepEqual([r.n, r.total, r.max], [2, 7, 5]);
    assert.ok(s.report().includes("2 calls"));
    assert.throws(() => s.wrap("y", () => { throw new Error("e"); })(), /e/);
    s.reset(); assert.equal(s.rows().length, 0);
  });

  console.log("\n" + passed + " notes P4 tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
