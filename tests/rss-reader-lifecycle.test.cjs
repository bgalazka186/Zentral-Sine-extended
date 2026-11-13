"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { El, document } = require("./helpers/fake-dom.cjs")();
document.documentElement.toggleAttribute = function (key, enabled) { if (enabled) this.setAttribute(key, ""); else this.removeAttribute(key); };
const window = new El("window"), first = new El("tabs"), second = new El("tabs"), observers = new Map(), prefs = new Map();
const services = { prefs: {
  getBoolPref: (key, fallback) => prefs.has(key) ? prefs.get(key) : fallback,
  prefHasUserValue: (key) => prefs.has(key), getStringPref: (key) => prefs.get(key), getIntPref: (key) => prefs.get(key),
  addObserver: (key, fn) => observers.set(key, fn), removeObserver: (key) => observers.delete(key),
} };
let feature; window.__zentralRssTestSeam = {}; window.gBrowser = { tabContainer: first }; window.ZentralRuntime = { services: {}, register: (f) => { feature = f; } }; window.document = document;
const timers = new Map(); let nextTimer = 1;
vm.runInNewContext(fs.readFileSync(require.resolve("../additional/rss/ZentralRssDisplay.uc.js"), "utf8"), { window, document, globalThis: { Services: services }, console, URL, MutationObserver: class { observe() {} disconnect() {} }, setTimeout: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; }, clearTimeout: (id) => timers.delete(id) });
const decision = window.__zentralRssTestSeam.readerBindingAction;
assert.equal(decision(false, null, first), "keep"); assert.equal(decision(true, null, first), "bind");
assert.equal(decision(true, first, first), "keep"); assert.equal(decision(true, first, second), "replace");
assert.equal(decision(false, first, first), "unbind"); assert.equal(decision(true, first, null), "unbind");
const dispose = feature.init(), key = "zen.workspace.bgalazka.rss.reader_card";
const count = (target, type) => target.listeners.filter((l) => l.type === type).length;
const assertBound = (target, n) => { for (const type of ["mouseover", "mousemove", "auxclick", "mouseleave"]) assert.equal(count(target, type), n, type); };
const assertWindow = (n) => { for (const type of ["popupshowing", "keydown"]) assert.equal(count(window, type), n, type); };
const set = (value) => { prefs.set(key, value); observers.get(key)(); };
assertBound(first, 0); set(true); assertBound(first, 1); assertWindow(1);
set(false); assertBound(first, 0); assertWindow(0);
set(true); set(true); assertBound(first, 1); assertWindow(1);
window.gBrowser.tabContainer = second; window.ZentralRuntime.services.rss.refresh();
assertBound(first, 0); assertBound(second, 1); assertWindow(1);
set(false); assertBound(second, 0); assertWindow(0);
set(true); dispose(); assertBound(second, 0); assertWindow(0); assert.equal(observers.size, 0);
console.log("RSS reader listener lifecycle passed");
