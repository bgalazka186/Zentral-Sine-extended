"use strict";
/* V4-QS fake-DOM regression: Quick Settings must fit normal fonts and spill/clamp at large fonts. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const win = {
  document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {},
  setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {},
};
win.window = win;
vm.runInNewContext(source, {
  window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math,
  Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" },
});
const c = win.__zentralNotesTestSeam.core;
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    raf.splice(0).forEach((fn) => fn());
    await new Promise((resolve) => setImmediate(resolve));
  }
};
let measuredFont = 13;
// Fake a card's natural layout size as text scales. Values fit a 400x600 sheet at 8/13/20 px;
// at 40 px they exceed both the sheet and the viewport, so the dialog must clamp and scroll.
Object.defineProperties(El.prototype, {
  offsetWidth: { configurable: true, get() { return this.classList?.contains("zn-dialog-card") ? 150 + measuredFont * 6 : 0; } },
  scrollWidth: { configurable: true, get() { return this.offsetWidth; } },
  offsetHeight: { configurable: true, get() { return this.classList?.contains("zn-dialog-card") ? 200 + measuredFont * 17 : 0; } },
  scrollHeight: { configurable: true, get() { return this.offsetHeight; } },
});
const files = new Map();
const io = {
  join: (...parts) => parts.join("/"), filename: (p) => p.split("/").pop(),
  async readUTF8(p) { if (!files.has(p)) throw new Error("NotFound " + p); return files.get(p).text; },
  async writeUTF8(p, text) { files.set(p, { text, mtime: Date.now() }); },
  async remove(p) { files.delete(p); }, async exists(p) { return files.has(p); },
  async children(dir) { return [...files.keys()].filter((p) => p.startsWith(dir + "/")); },
  async stat(p) { return { lastModified: files.get(p)?.mtime || 0 }; }, async restrict() {},
};
function adapter() {
  const host = new El("div");
  return { position: "fixed", host, attach: (root) => host.appendChild(root),
    getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }),
    watch: () => () => {}, setActive() {}, rewatch() {} };
}
(async () => {
  for (const font of [8, 13, 20, 40]) {
    measuredFont = font;
    const store = c.createStore({ io, notify() {}, windowId: "qs-" + font, getDir: async () => "/notes-qs-" + font,
      getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
    const sheet = c.createSheet({ store, adapter: adapter(),
      env: { getPref: (key, fallback) => key === c.PREF.FONT_SIZE ? font : fallback, setPref() {}, openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} },
      ensureStore: () => store.open() });
    await sheet.open();
    await flush();
    const settings = sheet.root.all().find((el) => el.title.startsWith("Quick settings"));
    assert.ok(settings, `Quick Settings button exists at ${font}px`);
    settings.click();
    await flush();
    const dialog = sheet.root.all().find((el) => el.classList?.contains("zn-dialog"));
    const card = dialog?.all().find((el) => el.classList?.contains("zn-dialog-card"));
    assert.ok(card, `Quick Settings dialog opens at ${font}px`);
    if (font <= 20) {
      assert.notEqual(dialog.dataset.spill, "true", `${font}px should fit inside the sheet`);
      assert.equal(card.style.position || "", "", `${font}px keeps the normal centered card layout`);
    } else {
      assert.equal(dialog.dataset.spill, "true", "40px should spill beyond the sheet");
      assert.equal(sheet.root.dataset.dialogSpill, "true", "sheet overflow is lifted while the card spills");
      assert.equal(card.style.position, "absolute");
      assert.equal(card.style.width, "390px");
      assert.equal(card.style.height, "788px", "card height is clamped to viewport height minus padding");
      const css = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
      assert.match(css, /\.zn-dialog-card\s*\{[^}]*overflow:\s*auto/s, "overflowing dialog content can scroll");
    }
    const done = dialog.all().find((el) => el.textContent === "Done");
    assert.ok(done, `Done button exists at ${font}px`);
    done.click();
    await flush();
    assert.ok(!sheet.root.all().some((el) => el.classList?.contains("zn-dialog")), "dialog closes cleanly");
    sheet.destroy();
    await store.close();
    console.log(`ok - Quick Settings fit/spill at ${font}px`);
  }
  console.log("\n4 Quick Settings font-size cases passed");
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
