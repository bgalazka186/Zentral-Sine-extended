"use strict";
/* OW-38 (part 7): Background tab dragging. The feature exists to answer one question: when someone presses a tab and
 * drags it, is the tab they pressed the one that moves, and does the press stay silent until it is known to be a
 * drag? Every answer comes from wrapping native tabbrowser members, so this suite runs the real `attach()` from
 * `additional/tabs/dragging/ZentralTabDrag.uc.js` against a fake tab strip and drives the same events Zen drives:
 * a press that becomes a drag, a press that becomes a click, a sleeping source tab, and a teardown. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createDom = require("./helpers/fake-dom.cjs");

const REPO = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(REPO, "additional/tabs/dragging/ZentralTabDrag.uc.js"), "utf8");
const PREF = "zen.workspace.zentral.tabs.background_drag";

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}
const json = (v) => JSON.parse(JSON.stringify(v));
const ids = (list) => [...list].map((tab) => tab.id);

/* A fake tab strip shaped like Zen's: tabs carry `multiselected`, the strip owns `tabDragAndDrop.startTabDrag`, and
 * `selectedTab` is a plain accessor that the feature wraps. */
function boot({ enabled = true } = {}) {
  // A real element of the fake DOM: `getAttribute` answers null when the attribute is absent.
  const createTab = (doc) => {
    const tab = doc.createElement("tab");
    tab.multiselected = false;
    return tab;
  };
  const { El, Ev, document } = createDom();
  const store = new Map([[PREF, enabled]]);
  const observers = [];
  const Services = {
    prefs: {
      getBoolPref: (k, f = false) => (store.has(k) ? Boolean(store.get(k)) : f),
      addObserver: (k, fn) => observers.push({ k, fn }),
      removeObserver: () => {},
    },
    obs: { addObserver: () => {}, removeObserver: () => {} },
  };
  const strip = document.createElement("div");
  strip.id = "tabbrowser-tabs";
  document.documentElement.appendChild(strip);
  const tabs = [];
  for (let i = 0; i < 3; i++) {
    const tab = createTab(document);
    tab.id = "tab-" + i;
    tab.group = null;
    tab.linkedPanel = "panel-" + i; // an ordinary loaded tab
    strip.appendChild(tab);
    tabs.push(tab);
  }
  const captureCalls = [];
  const thumbs = {
    captureToCanvas(browser) {
      captureCalls.push(browser);
      return Promise.resolve("captured");
    },
  };
  // Native startTabDrag collects its payload *during* the call, so the fake records what the getters answer then.
  const dnd = {
    drags: [],
    payload: null,
    tabs: null,
    captured: [],
    startTabDrag(event, item) {
      this.drags.push(item);
      this.payload = [...browser.selectedElements].map((t) => t.id);
      this.tabs = [...browser.selectedTabs].map((t) => t.id);
      // Native startTabDrag takes its thumbnail here, one per selected browser, while the drag is still being set up.
      const source = { _tab: item };
      const result = thumbs.captureToCanvas(source);
      this.captured.push(result);
      return "started";
    },
  };
  strip.tabDragAndDrop = dnd;
  // The strip's own selection accessor is what the feature wraps alongside gBrowser.selectedTab.
  let stripSelected = tabs[0];
  Object.defineProperty(strip, "selectedItem", {
    configurable: true,
    enumerable: true,
    get: () => stripSelected,
    set: (v) => { stripSelected = v; },
  });
  const selected = { tab: tabs[0] };
  const browser = {
    tabContainer: strip,
    isTab: (node) => tabs.includes(node),
    getTabForBrowser: (b) => b._tab || null,
    get selectedTab() { return selected.tab; },
    set selectedTab(v) { selected.tab = v; },
    setSelectedTab(tab) { selected.tab = tab; },
    get selectedTabs() { return [selected.tab]; },
    // Native collection: the multiselection plus the active tab.
    get selectedElements() { return tabs.filter((t) => t.multiselected || t === selected.tab); },
  };
  const win = {
    document,
    gBrowser: browser,
    PageThumbs: thumbs,
    Services,
    setTimeout: (fn) => { win.timers.push(fn); return win.timers.length; },
    clearTimeout: () => {},
    addEventListener: (type, fn) => win.listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      win.listeners = win.listeners.filter((l) => !(l.type === type && l.fn === fn));
    },
    listeners: [],
    timers: [],
  };
  win.window = win;
  const registrations = [];
  win.ZentralRuntime = { register: (def) => registrations.push(def) };

  const sandbox = {
    window: win, document, Services, console,
    ChromeUtils: { importESModule: () => ({ PageThumbs: thumbs, Services }) },
    URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, Array, Object, String, Boolean, Error, TypeError,
    setTimeout: win.setTimeout, clearTimeout: () => {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "ZentralTabDrag.uc.js" });
  return { win, browser, strip, tabs, dnd, thumbs, captureCalls, Services, store, observers, registrations, sandbox, document };
}

function fire(env, type, init) {
  const event = { type, isTrusted: true, button: 0, ...init };
  for (const listener of [...env.win.listeners]) if (listener.type === type) listener.fn(event);
  return event;
}

async function run() {
  const env = boot();
  const def = env.registrations.find((r) => r.id === "tab-drag");
  assert.ok(def, "the feature registers itself and nothing else");

  let config = null;
  def.init({
    lifecycle: {
      watchNative: (c) => { config = c; },
      listen: () => {}, own: () => {}, destroy: () => {},
    },
  });
  assert.ok(config, "start() hands the native contract to core");
  assert.deepEqual([...config.prefs], [PREF], "the one pref that turns it off");
  assert.equal(config.enabled(), true);
  assert.equal(config.resolve(), env.dnd, "the tab drag-and-drop object is the native target");

  const owns = [];
  const destroy = config.attach(env.dnd, { own: (fn) => owns.push(fn) });
  assert.equal(typeof destroy, "function", "attach hands back its teardown");
  assert.ok(owns.includes(destroy), "the teardown is registered with core, so a failed later step still rolls back");

  await test("a press on a background tab is silent until it becomes a drag", async () => {
    fire(env, "mousedown", { target: env.tabs[1] });
    assert.equal(env.browser.selectedTab, env.tabs[0], "the active tab does not change on press");
    // Releasing without a drag is a plain click: now the selection follows, exactly as native would.
    fire(env, "mouseup", { target: env.tabs[1] });
    assert.equal(env.browser.selectedTab, env.tabs[1], "a click selects the tab");
  });

  await test("the payload of a background drag is the pressed tab, not the active one", async () => {
    assert.deepEqual(ids(env.browser.selectedElements), ["tab-1"], "outside a drag the native answer stands");
    fire(env, "mousedown", { target: env.tabs[2] });
    assert.equal(env.dnd.startTabDrag({ type: "mousedown" }, env.tabs[2]), "started", "the native start still runs");
    assert.deepEqual(env.dnd.payload, ["tab-2"], "the pressed tab is the payload");
    // Native startTabDrag normally selects the source; for a background drag that is exactly what must not happen.
    assert.equal(env.browser.selectedTab, env.tabs[1], "the active tab is left alone");
    assert.deepEqual(ids(env.browser.selectedTabs), ["tab-1"], "and so is selectedTabs");
  });

  await test("a multiselection keeps every member, and the active tab is not dragged along", async () => {
    env.tabs[2].multiselected = true;
    fire(env, "mousedown", { target: env.tabs[2] });
    env.dnd.startTabDrag({}, env.tabs[2]);
    // A multiselected source means the person picked a set: native collection is already right and is kept.
    assert.deepEqual(env.dnd.payload, ["tab-1", "tab-2"], "the multiselection is the payload");
    // A drag of a multiselection is defined as "explicitly multiselected tabs only": the active tab, which native
    // always reports, is not part of it.
    assert.deepEqual(env.dnd.tabs, [], "the active tab is not dragged along");
    env.tabs[2].multiselected = false;
  });

  await test("a sleeping source tab is not captured, and the caller still gets a promise", async () => {
    env.tabs[2].setAttribute("pending", "true");
    fire(env, "mousedown", { target: env.tabs[2] });
    env.captureCalls.length = 0;
    env.dnd.startTabDrag({}, env.tabs[2]);
    const result = env.dnd.captured.at(-1);
    assert.ok(result instanceof Promise, "the caller always gets a promise");
    assert.equal(await result, undefined, "nothing is captured for a tab that is not loaded");
    assert.deepEqual(env.captureCalls, [], "the native capture was not run");

    env.tabs[2].removeAttribute("pending");
    env.captureCalls.length = 0;
    env.dnd.startTabDrag({}, env.tabs[2]);
    assert.equal(env.captureCalls.length, 1, "a live tab is captured natively");
    assert.equal(await env.dnd.captured.at(-1), "captured", "and the native result is passed through");
  });

  await test("a press on a control inside the tab is left entirely to native", async () => {
    const button = env.document.createElement("button");
    env.tabs[1].appendChild(button);
    fire(env, "mousedown", { target: button });
    assert.deepEqual(ids(env.browser.selectedElements), ["tab-1"], "no gesture was opened");
    button.remove();
  });

  await test("a modified press is left to native: no deferred selection, no blocked set", async () => {
    // Shift/Ctrl/Alt presses are Zen's own multiselect gestures. The feature must not open a gesture for them, which
    // means nothing is deferred and nothing is blocked -- native answers both questions.
    fire(env, "mousedown", { target: env.tabs[2], shiftKey: true });
    assert.equal(env.browser.selectedTab, env.tabs[1], "a modified press does not select by itself");
    fire(env, "mouseup", { target: env.tabs[2], shiftKey: true });
    assert.equal(env.browser.selectedTab, env.tabs[1], "nor on release: native owns the multiselect");
  });

  await test("turning the pref off returns every native member unchanged", async () => {
    env.store.set(PREF, false);
    fire(env, "mousedown", { target: env.tabs[2] });
    env.dnd.startTabDrag({}, env.tabs[2]);
    assert.deepEqual(env.dnd.payload, ["tab-1"], "the native selection is untouched");
    env.store.set(PREF, true);
  });

  await test("destroy restores the wrapped members and stops answering events", async () => {
    destroy();
    assert.deepEqual(ids(env.browser.selectedElements), ["tab-1"], "selectedElements is native again");
    fire(env, "mousedown", { target: env.tabs[2] });
    assert.equal(env.browser.selectedTab, env.tabs[1], "a press after teardown changes nothing");
    assert.equal(env.win.listeners.filter((l) => l.type === "mousedown").length, 0, "and the listeners are gone");
  });

  console.log("\nPASS tab-drag (" + passed + " tests)");
}

run().catch((error) => {
  console.error("FAIL", error);
  process.exit(1);
});
