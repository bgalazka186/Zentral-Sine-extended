"use strict";
/* Pure parsing and MIME validation for T1.15 media embeds. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
const plain = (x) => JSON.parse(JSON.stringify(x));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

test("YouTube URLs accept supported HTTPS hosts and canonicalize to youtube-nocookie", () => {
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=20s",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
    "https://m.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    const parsed = c.parseYouTubeUrl(url);
    assert.equal(parsed?.id, "dQw4w9WgXcQ", url);
    assert.equal(parsed?.embedUrl, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", url);
  }
});

test("YouTube URL parsing rejects unsafe protocols, lookalike hosts, malformed IDs and credentials", () => {
  for (const url of [
    "http://youtu.be/dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://evil.test/?v=dQw4w9WgXcQ",
    "https://youtu.be/short",
    "https://youtu.be/dQw4w9WgXcQextra",
    "https://youtu.be/dQw4w9WgXcQ/extra",
    "https://user:pass@youtu.be/dQw4w9WgXcQ",
    "https://youtu.be:444/dQw4w9WgXcQ",
    "https://youtube.com/watch?list=PL123",
    "javascript:alert(1)",
  ]) assert.equal(c.parseYouTubeUrl(url), null, url);
});

test("YouTube image markdown becomes a click-load media node, not a remote image", () => {
  const [node] = c.parseInline("![Demo clip](https://youtu.be/dQw4w9WgXcQ)");
  assert.equal(node.t, "youtube");
  assert.equal(node.videoId, "dQw4w9WgXcQ");
  assert.equal(node.alt, "Demo clip");
  assert.equal(c.parseInline("![Not YouTube](https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ)")[0].t, "img");
});

test("YouTube transclusions parse into a bounded provider descriptor", () => {
  const parsed = c.parseEmbedTarget("https://www.youtube.com/watch?v=dQw4w9WgXcQ|640");
  assert.equal(parsed.youtube.id, "dQw4w9WgXcQ");
  assert.equal(parsed.width, 640);
  assert.equal(c.parseEmbedTarget("https://example.com/video")?.youtube, null);
});

test("local video asset links accept only supported safe assets paths", () => {
  for (const file of ["movie.mp4", "movie.m4v", "clip.webm", "clip.ogv", "clip.ogg"]) {
    const parsed = c.parseVideoAssetLink("assets/note_01/" + file);
    assert.equal(parsed?.noteId, "note_01");
    assert.equal(parsed?.file, file);
    assert.ok(parsed?.mime.startsWith("video/"));
  }
  for (const src of [
    "../movie.mp4", "/assets/note_01/movie.mp4", "assets/../movie.mp4",
    "assets/note/movie.mp4?x=1", "assets/note/movie.mp4#x", "assets/note/movie.svg",
    "assets/note/sub/movie.mp4", "assets/note\\movie.mp4", "https://example.test/movie.mp4",
  ]) assert.equal(c.parseVideoAssetLink(src), null, src);
});

test("local video transclusions and Markdown asset links become native-video nodes", () => {
  const [transclusion] = c.parseInline("![[clip.webm]]");
  assert.equal(transclusion.t, "embed");
  assert.equal(c.parseEmbedTarget(transclusion.target).videoAsset, "clip.webm");
  const [asset] = c.parseInline("![Training](assets/note_01/training.mp4)");
  assert.equal(asset.t, "video");
  assert.equal(asset.asset, "assets/note_01/training.mp4");
  assert.equal(asset.alt, "Training");
  assert.equal(c.parseEmbedTarget("../clip.mp4").videoAsset, "");
});

test("asset reference accounting keeps linked and note-local video assets discoverable", () => {
  assert.deepEqual(plain([...c.assetRefs("![x](assets/note_01/still.png)\n![v](assets/note_01/clip.mp4)")].sort()), ["assets/note_01/clip.mp4", "assets/note_01/still.png"]);
  assert.deepEqual(plain([...c.assetRefs("![[clip.webm]]", "note_01")]), ["assets/note_01/clip.webm"]);
});

test("exports replace interactive media players with clear non-fetching placeholders", () => {
  const body = "![Lesson](https://youtu.be/dQw4w9WgXcQ)\n\n![[clip.mp4]]";
  const text = c.exportText(body);
  assert.ok(text.includes("[YouTube video: Lesson]"));
  assert.ok(text.includes("[video: clip.mp4]"));
  const html = c.exportHtml(body);
  assert.match(html, /\[YouTube video: Lesson\]/);
  assert.match(html, /\[local video: clip\.mp4\]/);
  assert.doesNotMatch(html, /youtube-nocookie\.com|<iframe|<video/);
  assert.match(c.EXPORT_FORMATS.html.loses, /YouTube, local videos and attached files become non-playing placeholders/);
  assert.match(c.EXPORT_FORMATS.html.loses, /local asset files are not bundled/);
  assert.match(c.EXPORT_FORMATS.pdf.loses, /YouTube, local videos and attached files are non-playing placeholders/);
});

test("video MIME sniffing checks container signatures instead of trusting file extensions", () => {
  const mp4 = new Uint8Array(16); mp4.set([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x77, 0x65, 0x62, 0x6d]);
  const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0]);
  assert.equal(c.sniffVideoMime(mp4, "video/mp4"), "video/mp4");
  assert.equal(c.sniffVideoMime(webm, "video/webm"), "video/webm");
  assert.equal(c.sniffVideoMime(ogg, "video/ogg"), "video/ogg");
  assert.equal(c.sniffVideoMime(mp4, "video/webm"), "");
  assert.equal(c.sniffVideoMime(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), "video/mp4"), "");
});

console.log(`${passed} media embed tests passed`);
