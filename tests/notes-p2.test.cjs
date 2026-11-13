"use strict";
/* Priority 2 (search, pasted pictures, reminders): pure helpers, store persistence and the reminder scheduler on a fake
 * clock. Node + fake IO only: it proves the logic, NOT Gecko I/O, clipboard access, sound, or live window timers. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const win = { __zentralNotesParts: { "notes-calendar": require("../additional/notes/calendar/ZentralNotesCalendar.js") }, document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, { window: win, document: dom.document, Event: dom.Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array });
const c = win.__zentralNotesTestSeam.core;
let passed = 0;
const tests = [];
const J = (x) => JSON.parse(JSON.stringify(x)); // results built inside the vm have another Array prototype
const test = (name, fn) => tests.push([name, fn]);

// ---- fake clock + fake IO -------------------------------------------------------------------------
function clock(start) {
  let t = start, id = 0; const timers = new Map();
  return {
    now: () => t, setTimer: (fn, ms) => { const k = ++id; timers.set(k, { fn, at: t + ms }); return k; }, clearTimer: (k) => timers.delete(k),
    get active() { return timers.size; }, delays: () => [...timers.values()].map((x) => x.at - t),
    // A separate "lane" for the scheduler's timers, so the store's own autosave timers are not counted.
    lane() { const mine = new Set(); return {
      setTimer: (fn, ms) => { const k = ++id; timers.set(k, { fn, at: t + ms }); mine.add(k); return k; },
      clearTimer: (k) => { mine.delete(k); timers.delete(k); },
      get active() { return [...mine].filter((k) => timers.has(k)).length; },
      delays: () => [...mine].filter((k) => timers.has(k)).map((k) => timers.get(k).at - t),
    }; },
    async advance(ms) { const end = t + ms; for (;;) { const next = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; t = Math.max(t, next[1].at); timers.delete(next[0]); next[1].fn(); await settle(); } t = end; await settle(); },
  };
}
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };
function fakeIO() {
  const files = new Map(), dirs = new Set();
  const io = {
    files, dirs,
    join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; },
    writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }),
    remove: async (p) => files.delete(p), exists: async (p) => files.has(p),
    children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
    stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }), restrict: async () => {},
    makeDir: async (d) => dirs.add(d), writeBytes: async (p, b) => { if (files.has(p)) throw new Error("exists"); files.set(p, { bytes: b, mtime: Date.now() }); },
    readBytes: async (p) => { if (!files.has(p) || !files.get(p).bytes) throw new Error("nf"); return files.get(p).bytes; },
    removeTree: async (d) => { for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k); },
  };
  return io;
}
const mkStore = (io, clk, extra = {}) => c.createStore({ io, notify() {}, windowId: extra.windowId || "t", now: clk.now, getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: clk.setTimer, clearTimer: clk.clearTimer });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

// ---- search ---------------------------------------------------------------------------------------
test("find: literal, case and accent folding with stable offsets", () => {
  const text = "Zażółć gęślą jaźń. ZAŻÓŁĆ again";
  const m = c.findMatches(text, "zazolc");
  assert.equal(m.length, 2);
  assert.equal(text.slice(m[0].start, m[0].end), "Zażółć");
  assert.equal(text.slice(m[1].start, m[1].end), "ZAŻÓŁĆ");
  assert.equal(c.foldText("Łódź").length, 4);
  assert.deepEqual(J(c.findMatches("a.b a+b", "a.b").map((x) => x.start)), [0], "regex characters are literal");
  assert.deepEqual(J(c.findMatches("aaaa", "aa").map((x) => x.start)), [0, 2], "matches do not overlap");
  assert.deepEqual(J(c.findMatches("abc", "  ")), [], "blank query matches nothing");
  assert.deepEqual(c.findMatches("one two", "one two").length, 1, "a phrase is one match");
  assert.equal(c.findMatches("x".repeat(5000), "x").length, c.FIND_MAX_MATCHES, "match cap");
  assert.equal(c.foldText("한국어"), "한국어", "non-Latin text is not mangled by folding");
});
test("find: runs (rendered text) never span nodes; navigation wraps", () => {
  const r = c.findInRuns(["foo ba", "r foo", "bar"], "foo");
  assert.deepEqual(J(r.map((x) => [x.run, x.start])), [[0, 0], [1, 2]]);
  assert.equal(c.findInRuns(["foo ba", "r"], "foo bar").length, 0);
  assert.equal(c.stepMatchIndex(-1, 3, 1), 0);
  assert.equal(c.stepMatchIndex(-1, 3, -1), 2);
  assert.equal(c.stepMatchIndex(2, 3, 1), 0);
  assert.equal(c.stepMatchIndex(0, 3, -1), 2);
  assert.equal(c.stepMatchIndex(0, 0, 1), -1);
  assert.equal(c.firstMatchFrom([{ start: 0, end: 2 }, { start: 10, end: 12 }], 5), 1);
  assert.equal(c.firstMatchFrom([{ start: 0, end: 2 }], 50), 0, "wraps to the first match");
});
test("find: other notes exclude the current and trashed notes", () => {
  const notes = [
    { id: "a", body: "Meeting notes", updated: 1 }, { id: "b", body: "meeting agenda", updated: 3 },
    { id: "c", body: "gone meeting", trashed: 5, updated: 9 }, { id: "d", body: "nothing", label: "Meeting", updated: 2 },
    { id: "e", body: "unrelated", updated: 4 },
  ];
  const r = c.searchOtherNotes(notes, "MEETING", "a");
  assert.equal(r.count, 2);
  assert.deepEqual(J(r.ids), ["b", "d"], "newest first, no current note, no trashed note");
  assert.equal(c.searchOtherNotes(notes, " ", "a").count, 0);
});
test("find: revealScroll scrolls only when the match is outside the view", () => {
  assert.equal(c.revealScroll({ y: 300, h: 20, top: 200, height: 300 }), null);
  assert.equal(c.revealScroll({ y: 900, h: 20, top: 0, height: 300 }), 800, "off-screen below: scroll so it sits in the upper third");
  assert.equal(c.revealScroll({ y: 10, h: 20, top: 500, height: 300 }), 0, "off-screen above");
  assert.equal(c.revealScroll({ y: 290, h: 20, top: 0, height: 300 }) !== null, true, "partly clipped counts as off-screen");
  assert.equal(c.lineOfOffset("a\nb\nc", 4), 2);
});

// ---- pictures -------------------------------------------------------------------------------------
test("assets: type, size and claimed-MIME limits", () => {
  assert.equal(c.checkAssetBytes(PNG, "image/png").ok, true);
  assert.equal(c.checkAssetBytes(JPG).ext, "jpg");
  assert.equal(c.checkAssetBytes(GIF).ok && c.checkAssetBytes(WEBP).ok, true);
  assert.equal(c.checkAssetBytes(PNG, "image/jpeg").reason, "mismatch");
  assert.equal(c.checkAssetBytes(Uint8Array.from(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), "image/svg+xml").reason, "type");
  assert.equal(c.checkAssetBytes(new Uint8Array(0)).reason, "empty");
  assert.equal(c.checkAssetBytes(new Uint8Array(c.ASSET_MAX_BYTES + 1).fill(1)).reason, "too-big");
  const big = new Uint8Array(c.ASSET_MAX_BYTES); big.set(PNG); assert.equal(c.checkAssetBytes(big).ok, true, "exactly the cap is fine");
});
test("assets: path safety of links", () => {
  const ok = c.parseAssetLink("assets/n1abc-0001/img-20261101-101010-abc.png#w=320&a=center");
  assert.deepEqual(J([ok.noteId, ok.file, ok.width, ok.align]), ["n1abc-0001", "img-20261101-101010-abc.png", 320, "center"]);
  for (const bad of ["../assets/a/b.png", "assets/../b.png", "assets/a/../b.png", "assets/a/b/c.png", "/assets/a/b.png", "assets/a/b.svg", "assets//b.png",
    "assets/.a/b.png", "assets/a/.b.png", "assets/a\\b.png", "assets/a/b.png?x=1", "file:///etc/passwd", "https://x.test/a.png", "assets/a b/c.png", "assets/a/b c.png", "assets/%2e%2e/b.png", "assets/a/b.png#<script>"])
    assert.equal(c.parseAssetLink(bad), null, bad);
  assert.equal(c.parseAssetLink("assets/a/b.png#w=99999").width, 0, "absurd width is ignored");
  assert.equal(c.parseAssetLink("assets/a/b.png#a=evil").align, "");
  assert.equal(c.isAssetNoteId("n1-a"), true);
  for (const bad of ["", ".hidden", "a/b", "a b", "a.b", "..", "a\\b"]) assert.equal(c.isAssetNoteId(bad), false, bad);
  assert.match(c.assetFileName("jpeg", Date.UTC(2026, 10, 1, 10, 5, 9), () => 0.5), /^img-20261101-100509-[0-9a-z]{3}\.jpg$/);
});
test("assets: markdown links, alignment, size and edits", () => {
  const rel = "assets/n1/img-1.png";
  assert.equal(c.buildAssetImage("a [b]", rel), "![a  b](assets/n1/img-1.png)");
  assert.equal(c.buildAssetImage("", rel, { width: 320, align: "center" }), "![](assets/n1/img-1.png#w=320&a=center)");
  assert.equal(c.buildAssetLink(rel, { width: 5, align: "x" }), rel, "invalid options are dropped");
  const e = c.insertAssetImage("hello", 5, 5, "pic", rel);
  assert.equal(e.text, "\n\n![pic](assets/n1/img-1.png)");
  const v = "intro\n\n![pic](assets/n1/img-1.png)\n\nend";
  const r = c.restyleAssetImage(v, 12, { width: 200, align: "right" });
  assert.equal(v.slice(0, r.start) + r.text + v.slice(r.end), "intro\n\n![pic](assets/n1/img-1.png#w=200&a=right)\n\nend");
  assert.equal(c.restyleAssetImage(v, 2, { width: 200 }), null, "caret outside a picture");
  assert.equal(c.assetImageAt("![x](https://a.test/x.png)", 3), null, "remote images are not asset images");
  assert.deepEqual(J([...c.assetRefs(v + "\n![z](assets/n2/img-2.gif)")]), [rel, "assets/n2/img-2.gif"]);
});
test("assets: markdown parser keeps remote images click-to-load and renders asset images from the folder only", () => {
  const nodes = c.parseInline("![p](assets/n1/img-1.png#w=300&a=left) ![r](https://x.test/y.png) ![bad](assets/../x.png)");
  const imgs = nodes.filter((n) => n.t === "img");
  assert.equal(imgs.length, 2);
  assert.deepEqual(J([imgs[0].asset, imgs[0].width, imgs[0].align, imgs[0].href ?? null]), ["assets/n1/img-1.png", 300, "left", null]);
  assert.equal(imgs[1].href, "https://x.test/y.png");
  assert.equal(imgs[1].asset, undefined);
  assert.ok(nodes.some((n) => n.t === "text" && n.s.includes("../x.png")), "traversal stays plain text");
  assert.doesNotMatch(c.exportHtml("![p](assets/n1/img-1.png)"), /<img[^>]+assets\//, "HTML export never points at a folder that is not there");
});
test("assets: store saves, persists, re-reads and removes pictures; refuses bad input", async () => {
  const io = fakeIO(), clk = clock(Date.UTC(2026, 10, 1, 9, 0, 0));
  const store = mkStore(io, clk); await store.open();
  const n = store.create("note with picture");
  const saved = await store.saveAsset(n.id, PNG, "image/png");
  assert.equal(saved.ok, true);
  assert.match(saved.rel, new RegExp("^assets/" + n.id + "/img-20261101-090000-[0-9a-z]{3}\\.png$"));
  assert.ok(io.files.has("/n/" + saved.rel), "file lives under the notes folder");
  assert.deepEqual(J([...io.dirs]), ["/n/assets/" + n.id]);
  const back = await store.readAsset(saved.rel);
  assert.equal(back.mime, "image/png");
  assert.deepEqual([...back.bytes], [...PNG]);
  const MP4 = Uint8Array.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
  const videoRel = "assets/" + n.id + "/clip.mp4";
  io.files.set("/n/" + videoRel, { bytes: MP4, mtime: Date.now() });
  const videoBack = await store.readAsset(videoRel);
  assert.equal(videoBack.mime, "video/mp4", "known local video containers are served to the native player");
  assert.deepEqual([...videoBack.bytes], [...MP4]);
  const mismatchRel = "assets/" + n.id + "/not-webm.webm";
  io.files.set("/n/" + mismatchRel, { bytes: MP4, mtime: Date.now() });
  assert.equal(await store.readAsset(mismatchRel), null, "file extension cannot override the container signature");
  assert.equal(await store.readAsset("assets/../meta.json"), null);
  assert.equal(await store.readAsset("assets/" + n.id + "/nope.png"), null);
  assert.equal((await store.saveAsset(n.id, Uint8Array.from(Buffer.from("MZ......payload...")), "image/png")).reason, "type");
  assert.equal((await store.saveAsset("missing", PNG)).reason, "note");
  const odd = store.create("x"); odd.id; // generated ids are always safe; an imported odd file name is refused
  assert.equal((await mkStore(fakeIO(), clk).saveAsset("a b", PNG)).ok, false);
  const noIO = fakeIO(); delete noIO.writeBytes; const s2 = mkStore(noIO, clk); await s2.open(); const n2 = s2.create("x");
  assert.equal((await s2.saveAsset(n2.id, PNG)).reason, "io", "fails safely when asset I/O is unavailable");
  store.update(n.id, "![p](" + saved.rel + ")");
  await store.flush();
  const again = mkStore(io, clk); await again.open();
  assert.ok(again.get(n.id).body.includes(saved.rel), "link survives a restart");
  assert.ok((await again.readAsset(saved.rel)).bytes.length, "picture survives a restart");
  await again.deleteForever(n.id);
  assert.equal([...io.files.keys()].some((k) => k.includes("/assets/")), false, "pictures go with their note");
});
test("assets: a picture another note still shows is kept when its note is deleted", async () => {
  const io = fakeIO(), clk = clock(Date.UTC(2026, 10, 1, 9, 0, 0));
  const store = mkStore(io, clk); await store.open();
  const a = store.create("a"), b = store.create("b");
  const s = await store.saveAsset(a.id, PNG);
  store.update(b.id, "copy ![x](" + s.rel + ")");
  await store.flush();
  await store.deleteForever(a.id);
  assert.ok(io.files.has("/n/" + s.rel));
});
test("assets: full-size per-note limit", async () => {
  const io = fakeIO(), clk = clock(Date.UTC(2026, 10, 1, 9, 0, 0)); const store = mkStore(io, clk); await store.open();
  const n = store.create("x");
  for (let i = 0; i < c.ASSET_MAX_PER_NOTE; i++) io.files.set("/n/assets/" + n.id + "/f" + i + ".png", { bytes: PNG });
  assert.equal((await store.saveAsset(n.id, PNG)).reason, "too-many");
});

// ---- reminders ------------------------------------------------------------------------------------
const T0 = Date.UTC(2026, 10, 1, 9, 0, 0);
async function remStore(extraNotes = []) {
  const io = fakeIO(), clk = clock(T0), store = mkStore(io, clk);
  await store.open();
  const fired = [];
  const lane = clk.lane();
  const sched = c.createReminderScheduler({ store, now: clk.now, setTimer: lane.setTimer, clearTimer: lane.clearTimer, onDue: (list) => fired.push(list.map((n) => n.id)) });
  return { io, clk: { now: clk.now, advance: clk.advance, get active() { return lane.active; }, delays: lane.delays }, store, sched, fired };
}
test("reminders: whole-minute granularity (Cycle F #15) and persisted front matter", async () => {
  assert.equal(c.cleanRemind(T0 + 7 * 60000), T0 + 7 * 60000);
  assert.equal(c.cleanRemind(T0 + 7 * 60000 + 29999), T0 + 7 * 60000);
  assert.equal(c.cleanRemind(T0 + 7 * 60000 + 30000), T0 + 8 * 60000);
  assert.equal(c.cleanRemind(NaN), 0); assert.equal(c.cleanRemind(5), 0);
  const { io, store } = await remStore();
  const n = store.create("call mum");
  assert.equal(store.setReminder(n.id, T0 + 3 * 60000), true);
  assert.equal(store.get(n.id).remind, T0 + 3 * 60000);
  await store.flush();
  const text = io.files.get("/n/" + n.id + ".md").text;
  assert.match(text, /\nremind: 2026-11-01T09:03:00\.000Z\n/);
  assert.doesNotMatch(text, /reminded:/);
  assert.equal(c.noteFromFile("x", text, 0).remind, T0 + 3 * 60000);
  assert.equal(c.noteFromFile("x", "---\nid: x\nremind: nonsense\n---\nb", 0).remind, 0);
  assert.equal(c.parseRemindInput("2026-11-02", "09:07"), new Date(2026, 10, 2, 9, 7).getTime());
  assert.equal(c.parseRemindInput("2026-02-31", "09:00"), 0);
  assert.equal(c.parseRemindInput("2026-11-02", "25:00"), 0);
});
test("reminders: ONE timer for the next due item, due batch fires once", async () => {
  const { clk, store, sched, fired } = await remStore();
  const a = store.create("a"), b = store.create("b"), d = store.create("d");
  store.setReminder(a.id, T0 + 3600000); store.setReminder(b.id, T0 + 600000); store.setReminder(d.id, T0 + 600000);
  await sched.start(); await settle();
  assert.equal(clk.active, 1, "exactly one timer however many reminders");
  assert.deepEqual(J(clk.delays()), [600000], "armed for the earliest");
  await clk.advance(600000);
  assert.deepEqual(J(fired.map((x) => x.sort())), [[b.id, d.id].sort()], "both due notes arrive as one batch");
  assert.equal(clk.active, 1); assert.deepEqual(J(clk.delays()), [3000000], "re-armed for the next one only");
  await clk.advance(3600000);
  assert.equal(fired.length, 2);
  assert.equal(clk.active, 0, "no timer when nothing is pending (no polling)");
  await clk.advance(7 * 86400000);
  assert.equal(fired.length, 2, "never repeats");
});
test("reminders: edits, deletes, trash and snooze/dismiss reschedule", async () => {
  const { clk, store, sched, fired } = await remStore();
  const a = store.create("a"), b = store.create("b");
  store.setReminder(a.id, T0 + 900000); store.setReminder(b.id, T0 + 1800000);
  await sched.start(); await settle();
  assert.deepEqual(J(clk.delays()), [900000]);
  store.setReminder(a.id, 0); await settle();
  assert.deepEqual(J(clk.delays()), [1800000], "clearing the earliest re-arms for the next");
  store.setReminder(a.id, T0 + 300000); await settle();
  assert.deepEqual(J(clk.delays()), [300000], "a new earlier reminder pulls the timer forward");
  store.trash(a.id); await settle();
  assert.deepEqual(J(clk.delays()), [1800000], "trashed notes never alert");
  store.restore(a.id); await settle();
  assert.deepEqual(J(clk.delays()), [300000]);
  await clk.advance(300000);
  assert.deepEqual(J(fired), [[a.id]]);
  assert.equal(store.get(a.id).reminded, store.get(a.id).remind, "announcement is recorded");
  store.snoozeReminder(a.id, 10); await settle();
  assert.equal(store.get(a.id).remind, c.ceilStep(clk.now() + 600000));
  assert.equal(store.get(a.id).reminded, 0);
  assert.equal(clk.delays().length, 1);
  await clk.advance(600000);
  assert.deepEqual(J(fired), [[a.id], [a.id]], "a snoozed reminder fires once more");
  store.setReminder(a.id, 0); await settle();
  await clk.advance(30 * 86400000);
  assert.deepEqual(J(fired.slice(2)), [[b.id]], "only the other note's reminder fired; the dismissed one stayed quiet");
  assert.equal(fired.length, 3);
  const e = store.create("e"); store.setReminder(e.id, clk.now() + 900000); await settle();
  assert.equal(clk.active, 1);
  await store.deleteForever(e.id); await settle();
  assert.equal(clk.active, 0, "deleting the last pending note leaves no timer");
});
test("reminders: overdue at startup fires once, restart does not repeat it", async () => {
  const io = fakeIO(), clk = clock(T0);
  const first = mkStore(io, clk); await first.open();
  const n = first.create("late");
  first.setReminder(n.id, T0 - 3600000); await first.flush();
  let fired = [];
  const mk = (store) => c.createReminderScheduler({ store, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer, onDue: (l) => fired.push(l.map((x) => x.id)) });
  const s1 = mk(first); await s1.start(); await settle();
  assert.deepEqual(J(fired), [[n.id]], "overdue reminder alerts once on startup");
  await first.flush(); s1.destroy();
  const second = mkStore(io, clk); await second.open();
  const s2 = mk(second); await s2.start(); await settle(); await clk.advance(86400000);
  assert.deepEqual(J(fired), [[n.id]], "restart after the alert: no repeat");
  s2.destroy();
});
test("calendar reminders: scheduler expands stored occurrences, records alerts and suppresses duplicate notification", async () => {
  const { clk, store, sched, fired } = await remStore();
  const start = T0 + 5 * 60000;
  const item = store.items.upsert({ id: "calendar-live-reminder", summary: "Calendar reminder", start: { dateTime: new Date(start).toISOString() }, x: { kind: "reminder", src: "manual" } });
  assert.ok(item);
  await store.items.flush();
  await sched.start(); await settle();
  assert.deepEqual(J(clk.delays()), [4 * 60000], "adaptive Tier 1 lead schedules the pre-alert before the due stage");
  await clk.advance(5 * 60000); await settle();
  assert.equal(fired.length, 2, "pre-alert and due stages are delivered independently");
  assert.ok(fired.every((batch) => batch.some((id) => id.includes("calendar-live-reminder"))), "calendar stages are sent to the notification callback");
  const history = store.items.history.list({ itemId: item.id, occurrenceId: item.id });
  assert.deepEqual(J(history.filter((record) => record.action === "alerted").map((record) => record.stage).sort()), ["due", "pre"], "each stage is recorded before dispatch");
  assert.equal(store.items.history.stateFor(item.id, item.id), "pending", "alert audit does not complete the reminder");
  await sched.reschedule(); await settle();
  assert.equal(fired.length, 2, "the same scheduled occurrence stages are never announced twice");
  sched.destroy();
});
test("calendar reminders: recurrence expansion schedules the next matching occurrence", async () => {
  const { clk, store, sched, fired } = await remStore();
  const item = store.items.upsert({ id: "calendar-daily", summary: "Daily calendar reminder", start: { dateTime: new Date(T0 + 5 * 60000).toISOString() }, recurrence: ["RRULE:FREQ=DAILY;COUNT=2"], x: { kind: "reminder", src: "manual" } });
  await store.items.flush();
  await sched.start(); await settle();
  await clk.advance(5 * 60000); await settle();
  assert.equal(fired.length, 2, "the first occurrence delivers pre and due stages");
  assert.equal(store.items.history.list({ itemId: item.id }).filter((record) => record.action === "alerted").length, 2);
  assert.ok(clk.active >= 1, "the follow-up and next recurrence are scheduled after the first stages");
  await clk.advance(24 * 60 * 60 * 1000); await settle();
  assert.equal(fired.length, 5, "follow-up for occurrence one and pre/due for occurrence two alert independently");
  assert.equal(store.items.history.list({ itemId: item.id }).filter((record) => record.action === "alerted").length, 5);
  sched.destroy();
});

test("reminders: a second window that already announced it keeps this one silent", async () => {
  const io = fakeIO(), clk = clock(T0);
  const w1 = mkStore(io, clk, { windowId: "w1" }), w2 = mkStore(io, clk, { windowId: "w2" });
  await w1.open(); const n = w1.create("shared"); w1.setReminder(n.id, T0 + 300000); await w1.flush(); await w2.open();
  const log = [];
  const s1 = c.createReminderScheduler({ store: w1, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer, onDue: () => log.push("w1") });
  const s2 = c.createReminderScheduler({ store: w2, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer, onDue: () => log.push("w2") });
  await s1.start(); await s2.start(); await settle();
  await clk.advance(300000);
  assert.deepEqual(J(log), ["w1"], "only the first window to claim it alerts");
  s1.destroy(); s2.destroy();
});
test("reminders: disposal cancels the timer and silences late events", async () => {
  const { clk, store, sched, fired } = await remStore();
  const n = store.create("x"); store.setReminder(n.id, T0 + 300000);
  await sched.start(); await settle();
  assert.equal(clk.active, 1);
  sched.destroy(); sched.destroy();
  assert.equal(clk.active, 0);
  store.setReminder(n.id, T0 + 600000); await settle(); await clk.advance(86400000);
  assert.equal(clk.active, 0); assert.equal(fired.length, 0);
  assert.equal(c.reminderDelay(T0 + 10 * 365 * 86400000, T0), c.MAX_TIMER_MS, "a far-away reminder never overflows the timer");
});
test("reminders: presets are whole-minute aligned and in the future", () => {
  const list = c.reminderPresets(new Date(2026, 10, 1, 9, 2).getTime());
  assert.ok(list.length >= 3);
  for (const [label, t] of list) { assert.equal(t % c.REMIND_STEP_MS, 0, label); assert.ok(t > new Date(2026, 10, 1, 9, 2).getTime(), label); }
  assert.equal(new Date(list.find((x) => /Tomorrow/.test(x[0]))[1]).getHours(), 9);
});

(async () => {
  for (const [name, fn] of tests) { try { await fn(); passed++; } catch (e) { console.error("FAIL - " + name + "\n", e); process.exitCode = 1; } }
  if (!process.exitCode) console.log(passed + " notes P2 core tests passed");
})();
