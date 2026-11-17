"use strict";

// OW-36: Spell-check right-click menu tests (suggestions, Add to dictionary / Ignore word,
// multi-language picker, clipboard actions, persistence, fallback, and EN/PL i18n).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./helpers/fake-dom.cjs");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const CSS_SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.css"), "utf8");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const en = require("../additional/notes/i18n/en.js");
const pl = require("../additional/notes/i18n/pl.js");
cal.registerLanguage("en", en);
cal.registerLanguage("pl", pl);

function makeHarness({ files = new Map(), prefs = {}, lang = "en" } = {}) {
  const dom = createFakeDom();
  const { document, Ev: Event, raf } = dom;
  document.documentElement.clientWidth = 1280;
  document.documentElement.clientHeight = 820;

  let caretPos = null;
  document.caretPositionFromPoint = () => caretPos;
  const execCalls = [];
  document.execCommand = (cmd, _ui, val) => {
    execCalls.push({ cmd, val });
    return false; // force predictable fallback paths where tested
  };

  let curLang = lang;
  const prefStore = new Map(Object.entries(prefs));
  const Services = {
    obs: { addObserver() {}, removeObserver() {} },
    prefs: {
      getStringPref: (k, d) => (k === "zen.workspace.zentral.notes.language" ? curLang : (prefStore.has(k) ? String(prefStore.get(k)) : d)),
      getBoolPref: (k, d) => (prefStore.has(k) ? Boolean(prefStore.get(k)) : d),
      getIntPref: (k, d) => (prefStore.has(k) ? Number(prefStore.get(k)) : d),
      setStringPref: (k, v) => { if (k === "zen.workspace.zentral.notes.language") curLang = String(v); prefStore.set(k, String(v)); },
      setBoolPref: (k, v) => prefStore.set(k, Boolean(v)),
      setIntPref: (k, v) => prefStore.set(k, Number(v)),
    },
  };

  const clipboardLog = { written: [], readText: "PASTED" };
  const navigatorObj = {
    platform: "Linux",
    clipboard: {
      writeText: async (text) => { clipboardLog.written.push(text); },
      readText: async () => clipboardLog.readText,
    },
  };
  const win = {
    __zentralNotesParts: { "notes-calendar": cal },
    __zentralNotesLangTables: { en, pl },
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    document,
    navigator: navigatorObj,
    Intl,
    innerWidth: 1280,
    innerHeight: 820,
    requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; },
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;

  vm.runInNewContext(SRC, {
    window: win,
    document,
    Event,
    Services,
    globalThis: { Services },
    ChromeUtils: {},
    navigator: navigatorObj,
    Intl,
    URL,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise,
    Map,
    Set,
    WeakMap,
    RegExp,
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    TypeError,
    Uint8Array,
    TextEncoder,
    TextDecoder,
  });

  const core = win.__zentralNotesTestSeam.core;
  const io = {
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    exists: async (p) => files.has(p),
    readUTF8: async (p) => { if (!files.has(p)) throw Error("missing"); return files.get(p); },
    writeUTF8: async (p, text) => { files.set(p, text); },
    remove: async (p) => { files.delete(p); },
    children: async (p) => [...files.keys()].filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")),
    stat: async () => ({ lastModified: 0 }),
    restrict: async () => {},
  };

  const store = core.createStore({
    io,
    notify() {},
    windowId: "spell-test",
    getDir: async () => "/n",
    getMaxSaveMs: () => 1000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });

  const host = document.createElement("div");
  document.body.append(host);
  const adapter = {
    position: "fixed",
    attach(el) { host.append(el); },
    getArea() { return { left: 40, top: 40, width: 760, height: 520, right: 800, bottom: 560 }; },
    rect() { return { left: 40, top: 40, width: 760, height: 520, right: 800, bottom: 560 }; },
    watch() { return () => {}; },
    setActive() {},
    releaseSlot() {},
    isSuspended() { return false; },
  };
  const env = {
    getPref: (k, d) => (prefStore.has(k) ? prefStore.get(k) : d),
    setPref: (k, v) => { prefStore.set(k, v); },
    now: () => Date.UTC(2026, 10, 16, 10, 0, 0),
    openUrl() {},
    revealFolder() {},
  };

  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => Promise.resolve() });
  sheet.root.ownerDocument = document;
  Object.defineProperty(sheet.root, "offsetParent", { get: () => host });
  sheet.root.getBoundingClientRect = () => ({ left: 40, top: 40, width: 760, height: 520, right: 800, bottom: 560 });

  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      raf.splice(0).forEach((fn) => fn());
      await new Promise((r) => setImmediate(r));
    }
  };

  return {
    win,
    document,
    Event,
    core,
    store,
    sheet,
    files,
    prefStore,
    clipboardLog,
    execCalls,
    flush,
    setLang(l) { curLang = l; },
    setCaretPos(pos) { caretPos = pos; },
  };
}

// Mock Gecko nsIInlineSpellChecker + nsIEditorSpellCheck (Firefox 115+ async SetCurrentDictionaries).
function createMockGeckoSpellChecker({
  available = ["en-US", "pl-PL", "de-DE"],
  current = ["en-US"],
  dicts = {
    "en-US": new Set(["hello", "world", "note", "notes", "help", "halo", "testing", "don't", "well-known"]),
    "pl-PL": new Set(["cześć", "zażółć", "gęślą", "jaźń", "notatka"]),
    "de-DE": new Set(["hallo", "welt", "notiz"]),
  },
  suggestionsMap = {
    helo: ["hello", "halo", "help"],
    wrold: ["world"],
    glorp: [],
    zentralnotes: ["centralnotes"],
  },
  asyncSetDicts = true,
  legacyOutParams = false,
} = {}) {
  let activeDicts = [...current];
  const personalDict = new Set();
  const ignoredWords = new Set();
  let sugQueue = [];
  let recheckCalls = 0;
  const calls = { added: [], ignored: [], setDicts: [] };

  const spellChecker = {
    GetDictionaryList(outList, _outCount) {
      if (legacyOutParams && outList && typeof outList === "object") {
        outList.value = [...available];
        return;
      }
      if (legacyOutParams) throw Error("requires out param");
      return [...available];
    },
    GetCurrentDictionaries(outList, _outCount) {
      if (legacyOutParams && outList && typeof outList === "object") {
        outList.value = [...activeDicts];
        return;
      }
      if (legacyOutParams) throw Error("requires out param");
      return [...activeDicts];
    },
    SetCurrentDictionaries(next) {
      calls.setDicts.push([...next]);
      if (asyncSetDicts) {
        return Promise.resolve().then(() => {
          activeDicts = [...next];
        });
      }
      activeDicts = [...next];
      return undefined;
    },
    CheckCurrentWord(word) {
      const lower = String(word || "").toLowerCase();
      if (personalDict.has(word) || personalDict.has(lower) || ignoredWords.has(word) || ignoredWords.has(lower)) {
        sugQueue = [];
        return false; // not misspelled
      }
      for (const code of activeDicts) {
        const set = dicts[code];
        if (set && (set.has(word) || set.has(lower))) {
          sugQueue = [];
          return false; // valid in an active language
        }
      }
      sugQueue = [...(suggestionsMap[lower] || suggestionsMap[word] || [])];
      return true; // misspelled!
    },
    GetSuggestedWord() {
      return sugQueue.length ? sugQueue.shift() : "";
    },
    AddWordToDictionary(word) {
      personalDict.add(word);
      calls.added.push(word);
    },
    IgnoreWordAllOccurrences(word) {
      ignoredWords.add(word);
      calls.ignored.push(word);
    },
  };

  const inlineSpellChecker = {
    enableRealTimeSpell: true,
    spellChecker,
    addWordToDictionary(word) {
      personalDict.add(word);
      calls.added.push(word);
    },
    ignoreWord(word) {
      ignoredWords.add(word);
      calls.ignored.push(word);
    },
    spellCheckRange() {
      recheckCalls++;
    },
  };

  return {
    inlineSpellChecker,
    editor: { getInlineSpellChecker: () => inlineSpellChecker },
    getActiveDicts: () => [...activeDicts],
    getRecheckCalls: () => recheckCalls,
    calls,
  };
}

let passed = 0;
const plain = (v) => JSON.parse(JSON.stringify(v));
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

(async () => {
  await test("pure helpers: wordRangeAtOffset, replaceWordRange, cleanSpellLanguages, toggleSpellLanguage, formatSpellLanguageLabel, collectSpellSuggestions, buildEditorSpellMenuModel", async () => {
    const h = makeHarness();
    const C = h.core;

    // 1. wordRangeAtOffset: mid-word, start, end, Unicode Polish, apostrophe, hyphen, punctuation, numbers, whitespace
    assert.deepEqual(plain(C.wordRangeAtOffset("Hello wrold!", 8)), { word: "wrold", start: 6, end: 11 });
    assert.deepEqual(plain(C.wordRangeAtOffset("Hello wrold!", 6)), { word: "wrold", start: 6, end: 11 });
    assert.deepEqual(plain(C.wordRangeAtOffset("Hello wrold!", 11)), { word: "wrold", start: 6, end: 11 });
    assert.deepEqual(plain(C.wordRangeAtOffset("zażółć gęślą jaźń", 2)), { word: "zażółć", start: 0, end: 6 });
    assert.deepEqual(plain(C.wordRangeAtOffset("don't well-known!", 3)), { word: "don't", start: 0, end: 5 });
    assert.deepEqual(plain(C.wordRangeAtOffset("don't well-known!", 11)), { word: "well-known", start: 6, end: 16 });
    assert.deepEqual(plain(C.wordRangeAtOffset("'(helo)!'", 4)), { word: "helo", start: 2, end: 6 });
    assert.equal(C.wordRangeAtOffset("Year 2026 now", 6), null, "pure numbers are skipped");
    assert.equal(C.wordRangeAtOffset("foo   bar", 4), null, "whitespace returns null");
    // Selection handling: single-word selection returns trimmed word; multi-word selection uses clicked offset
    assert.deepEqual(plain(C.wordRangeAtOffset("foo (wrold) bar", 4, 4, 11)), { word: "wrold", start: 5, end: 10 });
    assert.deepEqual(plain(C.wordRangeAtOffset("helo wrold", 7, 0, 10)), { word: "wrold", start: 5, end: 10 });

    // 2. replaceWordRange
    const ed = C.replaceWordRange("Hello wrold!", 6, 11, "world");
    assert.deepEqual(plain(ed), { start: 6, end: 11, text: "world", selStart: 11, selEnd: 11 });

    // 3. cleanSpellLanguages & toggleSpellLanguage (multi-language + sole-language guard)
    assert.deepEqual(plain(C.cleanSpellLanguages(["en-US", "en-us", "pl-PL", "bad lang!", ""])), ["en-US", "pl-PL"]);
    assert.deepEqual(plain(C.cleanSpellLanguages("en-US, pl-PL")), ["en-US", "pl-PL"]);
    assert.deepEqual(plain(C.toggleSpellLanguage(["en-US"], "pl-pl", ["en-US", "pl-PL", "de-DE"])), ["en-US", "pl-PL"]);
    assert.deepEqual(plain(C.toggleSpellLanguage(["en-US", "pl-PL"], "en-US", ["en-US", "pl-PL"])), ["pl-PL"]);
    assert.deepEqual(plain(C.toggleSpellLanguage(["pl-PL"], "pl-PL", ["en-US", "pl-PL"])), ["pl-PL"], "cannot remove last active dictionary");

    // 4. formatSpellLanguageLabel
    const enLabel = C.formatSpellLanguageLabel("pl-PL", "en");
    assert.ok(enLabel.includes("pl-PL") && /Polish/i.test(enLabel), `EN label formatted nicely: ${enLabel}`);
    const plLabel = C.formatSpellLanguageLabel("en-US", "pl");
    assert.ok(plLabel.includes("en-US") && /angielski/i.test(plLabel), `PL label formatted nicely: ${plLabel}`);
    assert.ok(C.formatSpellLanguageLabel("en_US", "en").includes("en_US"));

    // 5. collectSpellSuggestions: dedupes, caps at SPELL_MAX_SUGGESTIONS, returns false for valid words
    let idx = 0;
    const fakeSc = {
      CheckCurrentWord: (w) => w === "teh",
      GetSuggestedWord: () => ["the", "the", "tea", "ten", "tee", "ted", "tel", "tek"][idx++] || "",
    };
    assert.deepEqual(plain(C.collectSpellSuggestions(fakeSc, "valid")), { misspelled: false, suggestions: [] });
    assert.deepEqual(plain(C.collectSpellSuggestions(fakeSc, "teh")), { misspelled: true, suggestions: ["the", "tea", "ten", "tee", "ted", "tel"] });

    // 6. buildEditorSpellMenuModel: misspelled, no-suggestions, readOnly, and unavailable engine
    const misspelledModel = C.buildEditorSpellMenuModel({
      wordInfo: { word: "helo", start: 0, end: 4 },
      spellEnabled: true,
      spellAvailable: true,
      misspelled: true,
      suggestions: ["hello", "halo"],
      availableDictionaries: ["en-US", "pl-PL"],
      currentDictionaries: ["en-US"],
      hasSelection: true,
    });
    assert.equal(misspelledModel[0].actionKind, "suggest");
    assert.equal(misspelledModel[0].bold, true);
    assert.equal(misspelledModel[0].label, "hello");
    assert.ok(misspelledModel.some((r) => r.actionKind === "add" && r.word === "helo"));
    assert.ok(misspelledModel.some((r) => r.actionKind === "ignore" && r.word === "helo"));
    const langGroup = misspelledModel.find((r) => r.actionKind === "languages");
    assert.ok(langGroup && langGroup.group.length === 2);
    assert.equal(langGroup.group[0].checked, true);
    assert.equal(langGroup.group[1].checked, false);

    const noSugModel = C.buildEditorSpellMenuModel({
      wordInfo: { word: "glorp", start: 0, end: 5 },
      spellEnabled: true,
      spellAvailable: true,
      misspelled: true,
      suggestions: [],
      availableDictionaries: ["en-US"],
      currentDictionaries: ["en-US"],
    });
    assert.equal(noSugModel[0].heading, true);
    assert.equal(noSugModel[0].id, "spell-no-suggestions");

    const roModel = C.buildEditorSpellMenuModel({
      wordInfo: { word: "helo", start: 0, end: 4 },
      spellEnabled: true,
      spellAvailable: true,
      misspelled: true,
      suggestions: ["hello"],
      readOnly: true,
      hasSelection: true,
    });
    assert.equal(roModel.some((r) => r.actionKind === "suggest"), false, "no suggestions in readOnly mode");
    assert.equal(roModel.find((r) => r.actionKind === "cut").enabled, false);
    assert.equal(roModel.find((r) => r.actionKind === "copy").enabled, true);
    assert.equal(roModel.find((r) => r.actionKind === "paste").enabled, false);

    const fallbackModel = C.buildEditorSpellMenuModel({
      wordInfo: { word: "helo", start: 0, end: 4 },
      spellEnabled: true,
      spellAvailable: false,
      misspelled: false,
    });
    assert.equal(fallbackModel.some((r) => r.actionKind === "languages"), false);
    assert.ok(fallbackModel.some((r) => r.actionKind === "toggleSpell"));

    assert.ok(CSS_SRC.includes(".zn-menu-item.is-bold"), "bold suggestion CSS rule present");
    assert.ok(CSS_SRC.includes(".zn-menu-check"), "menu checkmark CSS rule present");
    await h.store.close();
  });

  await test("live editor right-click: suggestion replacement, Add to dictionary, Ignore word, clipboard actions, and Check spelling toggle", async () => {
    const h = makeHarness();
    await h.store.open();
    const note = h.store.create("# Draft\nhelo wrold zentralnotes glorp");
    await h.sheet.open();
    h.sheet.openNote(note.id);
    await h.flush();

    const ta = h.sheet.root.querySelector("textarea.zn-editor");
    assert.ok(ta, "editor textarea exists");
    const mock = createMockGeckoSpellChecker();
    ta.editor = mock.editor;

    const rightClickAt = (offset) => {
      h.setCaretPos({ offsetNode: ta, offset });
      const ev = new h.Event("contextmenu", { bubbles: true, cancelable: true });
      ev.clientX = 120;
      ev.clientY = 140;
      ta.dispatchEvent(ev);
      return h.sheet.root.querySelector(".zn-menu");
    };

    // 1. Caret is at 0, right-click on "helo" (offset 10 inside "# Draft\nhelo ...")
    ta.setSelectionRange(0, 0);
    const menu1 = rightClickAt(10);
    assert.ok(menu1, "context menu opens on right-click");
    const sugBtns = [...menu1.querySelectorAll('.zn-menu-item[data-spell-action="suggest"]')];
    assert.deepEqual(sugBtns.map((b) => b.textContent), ["hello", "halo", "help"]);
    assert.ok(sugBtns[0].classList.contains("is-bold"), "suggestions are visually bold");

    // Click "hello" -> replaces ONLY "helo", preserves rest of note!
    sugBtns[0].click();
    await h.flush();
    assert.equal(ta.value, "# Draft\nhello wrold zentralnotes glorp");
    assert.equal(h.sheet.root.querySelector(".zn-menu"), null, "menu closes after suggestion click");

    // 2. Right-click "zentralnotes" -> click "Add to dictionary"
    const znOffset = ta.value.indexOf("zentralnotes") + 3;
    const menu2 = rightClickAt(znOffset);
    const addBtn = menu2.querySelector('.zn-menu-item[data-spell-action="add"]');
    assert.ok(addBtn && addBtn.textContent.includes("zentralnotes"));
    addBtn.click();
    await h.flush();
    assert.deepEqual(mock.calls.added, ["zentralnotes"]);
    assert.ok(mock.getRecheckCalls() >= 1, "re-checks document after adding word");

    // Subsequent right-click on "zentralnotes" offers NO spelling suggestions
    const menu2b = rightClickAt(znOffset);
    assert.equal(menu2b.querySelector('.zn-menu-item[data-spell-action="suggest"]'), null);
    assert.equal(menu2b.querySelector('.zn-menu-item[data-spell-action="add"]'), null);

    // 3. Right-click "glorp" (0 suggestions) -> shows "No spelling suggestions" heading + Ignore word
    const glorpOffset = ta.value.indexOf("glorp") + 2;
    const menu3 = rightClickAt(glorpOffset);
    const headRow = menu3.querySelector(".zn-menu-head");
    assert.ok(headRow && /No spelling suggestions/i.test(headRow.textContent));
    const ignoreBtn = menu3.querySelector('.zn-menu-item[data-spell-action="ignore"]');
    assert.ok(ignoreBtn && ignoreBtn.textContent.includes("glorp"));
    ignoreBtn.click();
    await h.flush();
    assert.deepEqual(mock.calls.ignored, ["glorp"]);

    // Subsequent right-click on "glorp" treats it as ignored
    const menu3b = rightClickAt(glorpOffset);
    assert.equal(menu3b.querySelector('.zn-menu-item[data-spell-action="ignore"]'), null);

    // 4. Select all + Copy + Cut clipboard actions
    const menu4 = rightClickAt(0);
    menu4.querySelector('.zn-menu-item[data-spell-action="selectAll"]').click();
    assert.equal(ta.selectionStart, 0);
    assert.equal(ta.selectionEnd, ta.value.length);

    ta.setSelectionRange(8, 13); // "hello"
    const menu5 = rightClickAt(9);
    const copyBtn = menu5.querySelector('.zn-menu-item[data-spell-action="copy"]');
    assert.equal(Boolean(copyBtn.disabled), false);
    copyBtn.click();
    assert.deepEqual(h.clipboardLog.written, ["hello"]);

    ta.setSelectionRange(8, 14); // "hello "
    const menu6 = rightClickAt(9);
    menu6.querySelector('.zn-menu-item[data-spell-action="cut"]').click();
    assert.equal(ta.value, "# Draft\nwrold zentralnotes glorp");

    // 5. Toggle "Check spelling" off -> pref updates, ta.spellcheck becomes false, no suggestions offered
    const menu7 = rightClickAt(ta.value.indexOf("wrold") + 2);
    const toggleBtn = menu7.querySelector('.zn-menu-item[data-spell-action="toggleSpell"]');
    assert.equal(toggleBtn.getAttribute("aria-checked"), "true");
    toggleBtn.click();
    await h.flush();
    assert.equal(h.prefStore.get("zen.workspace.zentral.notes.spellcheck"), false);
    assert.equal(ta.spellcheck, false);
    assert.equal(mock.inlineSpellChecker.enableRealTimeSpell, false);

    const menu8 = rightClickAt(ta.value.indexOf("wrold") + 2);
    assert.equal(menu8.querySelector('.zn-menu-item[data-spell-action="suggest"]'), null, "no suggestions while spellcheck is off");
    assert.equal(menu8.querySelector('.zn-menu-item[data-spell-action="toggleSpell"]').getAttribute("aria-checked"), "false");

    // Turn back on
    menu8.querySelector('.zn-menu-item[data-spell-action="toggleSpell"]').click();
    await h.flush();
    assert.equal(h.prefStore.get("zen.workspace.zentral.notes.spellcheck"), true);
    assert.equal(ta.spellcheck, true);

    h.sheet.destroy();
    await h.store.close();
  });

  await test("multi-language picker: switching/combining en-US + pl-PL, persistence across reload, legacy out-param fallback, and PL localization", async () => {
    const files = new Map();
    const h = makeHarness({ files });
    await h.store.open();
    const note = h.store.create("# Bilingual\nhello zażółć");
    await h.sheet.open();
    h.sheet.openNote(note.id);
    await h.flush();

    const ta = h.sheet.root.querySelector("textarea.zn-editor");
    const mock = createMockGeckoSpellChecker({ current: ["en-US"], available: ["en-US", "pl-PL", "de-DE"], asyncSetDicts: true });
    ta.editor = mock.editor;

    const rightClickAt = (offset) => {
      h.setCaretPos({ offsetNode: ta, offset });
      const ev = new h.Event("contextmenu", { bubbles: true, cancelable: true });
      ev.clientX = 100;
      ev.clientY = 100;
      ta.dispatchEvent(ev);
      return h.sheet.root.querySelector(".zn-menu");
    };

    // Initially only en-US is active -> Polish word "zażółć" is flagged as misspelled!
    const plOff = ta.value.indexOf("zażółć") + 2;
    const menu1 = rightClickAt(plOff);
    assert.ok(menu1.querySelector('.zn-menu-item[data-spell-action="add"]'), "Polish word flagged before pl-PL is enabled");

    // Open Languages submenu -> en-US checked, pl-PL unchecked -> click pl-PL to enable bilingual mode!
    const langBtn = menu1.querySelector('.zn-menu-item[data-spell-action="languages"]');
    assert.ok(langBtn && langBtn.textContent.includes("en-US"));
    langBtn.click();
    const langRows = [...menu1.querySelectorAll('.zn-menu-item[data-spell-action="toggleLanguage"]')];
    assert.equal(langRows.length, 3);
    assert.equal(langRows.find((b) => b.dataset.spellLang === "en-US").getAttribute("aria-checked"), "true");
    assert.equal(langRows.find((b) => b.dataset.spellLang === "pl-PL").getAttribute("aria-checked"), "false");

    const rechecksBefore = mock.getRecheckCalls();
    langRows.find((b) => b.dataset.spellLang === "pl-PL").click();
    await h.flush();
    assert.deepEqual(mock.getActiveDicts(), ["en-US", "pl-PL"]);
    assert.deepEqual(plain(h.store.meta.spellLanguages), ["en-US", "pl-PL"]);
    assert.ok(mock.getRecheckCalls() > rechecksBefore, "async SetCurrentDictionaries triggers spellCheckRange after resolve");

    // Now BOTH "hello" and "zażółć" pass spell-check!
    const menu2 = rightClickAt(plOff);
    assert.equal(menu2.querySelector('.zn-menu-item[data-spell-action="add"]'), null, "zażółć is valid with pl-PL active");
    const menu3 = rightClickAt(ta.value.indexOf("hello") + 2);
    assert.equal(menu3.querySelector('.zn-menu-item[data-spell-action="add"]'), null, "hello remains valid with en-US active");

    // Persist and reopen fresh store + sheet -> saved ["en-US", "pl-PL"] auto-applies even with legacy out-param Gecko API!
    await h.store.flush();
    h.sheet.destroy();
    await h.store.close();

    const h2 = makeHarness({ files, lang: "pl" });
    await h2.store.open();
    assert.deepEqual(plain(h2.store.meta.spellLanguages), ["en-US", "pl-PL"], "spellLanguages persists in meta.json");
    await h2.sheet.open();
    await h2.flush();

    const ta2 = h2.sheet.root.querySelector("textarea.zn-editor");
    const mock2 = createMockGeckoSpellChecker({ current: ["en-US"], available: ["en-US", "pl-PL"], asyncSetDicts: false, legacyOutParams: true });
    ta2.editor = mock2.editor;

    // Right-click in Polish UI triggers syncEditorSpellState -> applies persisted ["en-US", "pl-PL"] and shows PL strings!
    h2.setCaretPos({ offsetNode: ta2, offset: 0 });
    const evPl = new h2.Event("contextmenu", { bubbles: true, cancelable: true });
    evPl.clientX = 80;
    evPl.clientY = 80;
    ta2.dispatchEvent(evPl);
    const menuPl = h2.sheet.root.querySelector(".zn-menu");
    assert.deepEqual(mock2.getActiveDicts(), ["en-US", "pl-PL"], "persisted languages applied to fresh editor");
    assert.equal(menuPl.querySelector('.zn-menu-item[data-spell-action="toggleSpell"]').textContent, "Sprawdzaj pisownię");
    assert.equal(menuPl.querySelector('.zn-menu-item[data-spell-action="cut"]').textContent, "Wytnij");
    assert.equal(menuPl.querySelector('.zn-menu-item[data-spell-action="copy"]').textContent, "Kopiuj");
    assert.equal(menuPl.querySelector('.zn-menu-item[data-spell-action="paste"]').textContent, "Wklej");
    assert.equal(menuPl.querySelector('.zn-menu-item[data-spell-action="selectAll"]').textContent, "Zaznacz wszystko");
    assert.ok(menuPl.querySelector('.zn-menu-item[data-spell-action="languages"]').textContent.startsWith("Języki ("));

    // Graceful fallback when ta.editor is completely unavailable
    ta2.editor = null;
    const evFb = new h2.Event("contextmenu", { bubbles: true, cancelable: true });
    evFb.clientX = 90;
    evFb.clientY = 90;
    ta2.dispatchEvent(evFb);
    const menuFb = h2.sheet.root.querySelector(".zn-menu");
    assert.ok(menuFb, "fallback menu still opens without native editor");
    assert.ok(menuFb.querySelector('.zn-menu-item[data-spell-action="toggleSpell"]'));
    assert.equal(menuFb.querySelector('.zn-menu-item[data-spell-action="languages"]'), null);

    h2.sheet.destroy();
    await h2.store.close();
  });

  console.log(`\nPASS notes-spellcheck-menu (${passed} tests)`);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
