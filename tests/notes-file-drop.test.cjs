"use strict";
/* T1.16 pure file-name/link helpers and the note asset store, exercised through the public test seam. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, Uint8Array, console });
const c = seam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };

function fakeIO() {
  const files = new Map(), dirs = new Set();
  return {
    files, dirs,
    join: (...parts) => parts.join("/"), filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("missing"); return files.get(p).text; },
    writeUTF8: async (p, text) => files.set(p, { text, mtime: Date.now() }),
    remove: async (p) => files.delete(p), exists: async (p) => files.has(p),
    children: async (folder) => [...files.keys()].filter((p) => p.startsWith(folder + "/") && !p.slice(folder.length + 1).includes("/")),
    stat: async (p) => ({ size: files.get(p)?.bytes?.length ?? 0, lastModified: files.get(p)?.mtime || 0 }),
    restrict: async () => {}, makeDir: async (d) => dirs.add(d),
    writeBytes: async (p, bytes) => { if (files.has(p)) throw new Error("exists"); files.set(p, { bytes: new Uint8Array(bytes), mtime: Date.now() }); },
    readBytes: async (p) => { if (!files.has(p)) throw new Error("missing"); return files.get(p).bytes; },
    removeTree: async (folder) => { for (const p of [...files.keys()]) if (p.startsWith(folder + "/")) files.delete(p); },
  };
}

(async () => {
  await test("file names are normalized, path-stripped and safe for Windows and asset paths", () => {
    assert.equal(c.cleanAssetFileName("../../Résumé plan (final).PDF"), "Resume-plan-final.pdf");
    assert.equal(c.cleanAssetFileName("C:\\Temp\\Quarterly Report.xlsx"), "Quarterly-Report.xlsx");
    assert.equal(c.cleanAssetFileName("CON.txt"), "_CON.txt");
    assert.equal(c.cleanAssetFileName(".."), "");
    assert.equal(c.cleanAssetFileName("../../"), "");
    assert.ok(c.cleanAssetFileName("a".repeat(200) + ".pdf").length <= 89);
  });

  await test("collision-safe names compare case-insensitively and suffix before the extension", () => {
    assert.equal(c.uniqueAssetFileName("Report.pdf", []), "Report.pdf");
    assert.equal(c.uniqueAssetFileName("Report.pdf", ["report.PDF"]), "Report-2.pdf");
    assert.equal(c.uniqueAssetFileName("Readme", ["README", "readme-2"]), "Readme-3");
    assert.equal(c.uniqueAssetFileName("../", []), "");
  });

  await test("stored file links reject traversal, foreign paths, queries and media nodes", () => {
    assert.deepEqual(plain(c.parseFileAssetLink("assets/note_01/plan.pdf")), {
      rel: "assets/note_01/plan.pdf", noteId: "note_01", file: "plan.pdf", mime: "application/octet-stream",
    });
    for (const bad of [
      "../plan.pdf", "/assets/note_01/plan.pdf", "assets/../plan.pdf", "assets/note/../plan.pdf",
      "assets/note/plan.pdf?x=1", "assets/note/plan.pdf#x", "assets/note/sub/plan.pdf", "assets/note\\plan.pdf",
      "https://example.test/plan.pdf", "assets/note/.hidden", "assets/note/image.png", "assets/note/movie.mp4",
    ]) assert.equal(c.parseFileAssetLink(bad), null, bad);
  });

  await test("drop insertion chooses embeds for media and local download links for generic files", () => {
    assert.equal(c.droppedAssetMarkup("image.png", "assets/n1/image.png"), "![[image.png]]");
    assert.equal(c.droppedAssetMarkup("clip.webm", "assets/n1/clip.webm"), "![[clip.webm]]");
    assert.equal(c.droppedAssetMarkup("report.pdf", "assets/n1/report.pdf"), "[report.pdf](assets/n1/report.pdf)");
    const edit = c.insertDroppedAssetLinks("before after", 7, 7, [
      { file: "report.pdf", rel: "assets/n1/report.pdf" },
      { file: "clip.webm", rel: "assets/n1/clip.webm" },
    ]);
    assert.equal("before after".slice(0, edit.start) + edit.text + "before after".slice(edit.end), "before [report.pdf](assets/n1/report.pdf)\n![[clip.webm]]after");
    assert.equal(edit.selStart, edit.selEnd);
  });

  await test("Markdown local file links become download nodes while image and video handling stays specialized", () => {
    const [file] = c.parseInline("[Plan](assets/n1/plan.pdf)");
    assert.equal(file.t, "file");
    assert.equal(file.file, "plan.pdf");
    assert.equal(file.asset, "assets/n1/plan.pdf");
    assert.equal(c.parseInline("![img](assets/n1/image.png)")[0].t, "img");
    assert.equal(c.parseInline("![vid](assets/n1/clip.mp4)")[0].t, "video");
    assert.equal(c.parseInline("[bad](assets/../plan.pdf)")[0].t, "text");
    assert.deepEqual(plain([...c.assetRefs("[Plan](assets/n1/plan.pdf)\n![img](assets/n1/image.png)")].sort()), ["assets/n1/image.png", "assets/n1/plan.pdf"]);
  });

  await test("HTML and plain-text exports replace local attachments without broken profile paths", () => {
    const body = "[Plan](assets/n1/plan.pdf)";
    const html = c.exportHtml(body);
    assert.match(html, /\[file: plan\.pdf\]/);
    assert.doesNotMatch(html.split("<body>")[1], /assets\/n1\/plan\.pdf/);
    assert.equal(c.exportText(body).trim(), "[file: plan.pdf]");
    assert.match(c.EXPORT_FORMATS.html.loses, /attached files become non-playing placeholders/);
    assert.match(c.EXPORT_FORMATS.pdf.loses, /attached files are non-playing placeholders/);
  });

  await test("file drop extraction accepts real file-like items only and caps a large drag", () => {
    const files = Array.from({ length: 25 }, (_, i) => ({ name: `file-${i}.pdf`, arrayBuffer: async () => new ArrayBuffer(0) }));
    files.splice(2, 0, { name: "directory", webkitGetAsEntry: () => ({ isDirectory: true }) });
    assert.equal(c.droppedFiles({ files }).length, 20);
    assert.equal(c.droppedFiles({ files }, 2).length, 2);
    assert.deepEqual(plain(c.droppedFiles({ files: [{ name: "bad", arrayBuffer: 3 }, null] })), []);
    assert.deepEqual(plain(c.droppedFiles(null)), []);
  });

  await test("store writes original-safe names, suffixes collisions, reads as download-only bytes and checks bounds", async () => {
    let now = 1700000000000, timer = 0;
    const io = fakeIO();
    const store = c.createStore({ io, notify() {}, windowId: "file-drop", now: () => now, getDir: async () => "/notes", getMaxSaveMs: () => 5000, setTimer: () => ++timer, clearTimer: () => {} });
    await store.open();
    const note = store.create("Drop target");
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5]);
    const first = await store.saveFile(note.id, "Quarterly Report.pdf", bytes);
    assert.equal(first.ok, true);
    assert.equal(first.file, "Quarterly-Report.pdf");
    const second = await store.saveFile(note.id, "quarterly-report.PDF", bytes);
    assert.equal(second.ok, true);
    assert.equal(second.file, "quarterly-report-2.pdf");
    assert.deepEqual(plain(await store.readAsset(first.rel)), { bytes: { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, mime: "application/octet-stream" });
    assert.equal(await store.readAsset("assets/../meta.json"), null);
    const activeContent = await store.saveFile(note.id, "document.html", Uint8Array.from([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e]));
    assert.equal(activeContent.ok, true);
    assert.equal((await store.readAsset(activeContent.rel)).mime, "application/octet-stream", "HTML is download-only, never served as text/html");
    const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const validImage = await store.saveFile(note.id, "correct.PNG", imageBytes);
    assert.equal(validImage.ok, true);
    assert.equal((await store.readAsset(validImage.rel)).mime, "image/png");
    const validVideoBytes = new Uint8Array(16); validVideoBytes.set([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const validVideo = await store.saveFile(note.id, "correct.mp4", validVideoBytes);
    assert.equal(validVideo.ok, true);
    assert.equal((await store.readAsset(validVideo.rel)).mime, "video/mp4");
    assert.equal((await store.saveFile(note.id, "../../", bytes)).reason, "name");
    assert.equal((await store.saveFile(note.id, "fake.png", bytes)).reason, "type", "media extensions must match file signatures");
    assert.equal((await store.saveFile(note.id, "fake.mp4", bytes)).reason, "type", "video extensions must match container signatures");
    assert.equal((await store.saveFile("missing", "x.pdf", bytes)).reason, "note");
    assert.ok(io.files.has("/notes/" + first.rel));
  });

  console.log(`${passed} T1.16 file-drop core tests passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
