# PLAN 2 — DIAGNOSTICS (owner + Claude, worked on in the chat)

This document is NOT for the coding agent. The coding agent has `PLAN_CODING_AGENT.md`. Here we measure, test settings, find causes, and decide what else is worth building. Anything that turns into code becomes a task appended to the coding agent's plan.

## 1. How we work
1. One change at a time. Change, wait 30 s, measure, write the result in section 3, revert if there is no gain.
2. Repeat every CPU measurement 3 times with the SAME tabs open; CPU numbers vary a lot between runs (the GPU process read 79.6 %, then 37 %, then 20.5 %).
3. The Browser Console itself uses memory (a `DevTools global` realm of about 213 MB was seen in the browser process). Open a fresh console for each measurement session and close it afterwards.
4. Independent check for browser-process RAM: Task Manager → Details → the largest `zen.exe` (private working set). Compare with D1's `browser` row.
5. Commands are in section 9; every command copies its result to the clipboard.

## 2. What we know (baseline findings)

| # | Finding | Evidence |
|---|---|---|
| 1 | RAM is dominated by a few heavy pages: Messenger 0.55–0.92 GB, arena.ai 0.83–0.99 GB, WhatsApp 0.75–0.79 GB, an idle YouTube tab 1.1 GB, Twitch 0.76–0.92 GB, Claude 0.5–0.64 GB. | D1 (several runs) |
| 2 | Plain "minimize memory" freed 779 MB of 5858 MB (13 %), no loss. | D8 |
| 3 | The whole Zen window including all Zentral code is ~49 MB; script sources are tiny. Code-size work is pointless. | D3 |
| 4 | About 11 extra `web` processes (43–51 MB each, ≈ 0.5 GB) host Notes/Agenda placeholder tabs after restart. | D1 after restart on 3.3.307 |
| 5 | Browser process: 1431 MB and 1563 MB right after start, 839–1179 MB later in the session. Debug flags off and EcoQoS on did NOT change the startup value (1563 MB). | D1 runs |
| 6 | Browser main-thread CPU ≈ 21 % while Twitch plays, ≈ 4 % when no video plays. GPU process WebRender threads ≈ 34 % with Twitch, ≈ 10 % without. | D2, D10 |
| 7 | arena.ai content process burns 11–40 % of a core while hidden (essential panel tab, probably kept un-throttled by Zentral). | D2 (3 runs) |
| 8 | Task Manager shows the GTX 1660 Ti at 3–9 %. The "GPU 80 %" was GPU-process CPU time, not graphics load. | owner |
| 9 | uBlock Origin background page 52 MB, Dark Reader 10 MB, all other add-ons 1–3 MB. Extension process 226–341 MB. No add-on removal needed. | D3, D14 |
| 10 | Installed Sine mods: Transparent Zen, Customize Font Size, Arc 2.0, better-ctrl-tab, Zentral Extended, ZenLibraryTweaks, Tab Groups. Leftover prefs of Floaty/Nebula/Wireframe/Mac/Hapizen cost nothing. | D11, D5 |
| 11 | 45 tabs, 39 pinned, 4 essential, only 6 loaded: pinned tabs already restore on demand. | D7 |
| 12 | WhatsApp, Messenger, arena.ai are essential/pinned tabs shown as Zentral panels, not sidebar apps. | D7, code |
| 13 | Profiler is not running. Telemetry, prefetch, speculative connections already off. | D15, D5 |
| 14 | Whether a sleeping WhatsApp still notifies could not be tested: ASSUMED NO. WhatsApp/Messenger stay live by default. | owner |

## 3. Results log (append new rows)

| Date | Run | Total MB | Browser MB | Top content (MB) | Notes |
|---|---|---|---|---|---|
| 2026-11-17 | Fresh restart, 3.3.280 | 3388 | 1431 | WhatsApp 571, Messenger 537 | first baseline |
| 2026-11-17 | After a work session | 5837 | 961 | arena 924, Twitch 924, WhatsApp 747 | |
| 2026-11-17 | D8 minimize | 5858 → 5079 | – | – | freed 779 MB |
| 2026-11-18 | Idle, YouTube card only, no Twitch | ~6150 | 839 | YouTube 1112, arena 832, Messenger 916 | arena 35 % CPU, GPU proc 20.5 % |
| 2026-11-18 | Fresh restart, 3.3.307, debug off, EcoQoS on | 4114 | 1563 | WhatsApp 789, Messenger 549 | 11 Notes placeholder processes |

## 4. Open tests (status)

| Test | What to do | Looking at | Status |
|---|---|---|---|
| E8 | debug flags off, fresh console, D1 | browser MB at start | DONE: no gain at startup (1563 MB) |
| E9 | profiler check | – | DONE: not running |
| E10 | close Twitch, D10 + D2 | browser/GPU CPU | DONE: browser main thread falls to ~4 %; video playback is the cost |
| E11 | video preview + widgets off | browser main thread | PARTLY: stays low without video; need E12b with video playing |
| E12 | unload the arena.ai tab (middle-click), wait 30 s, D2 | arena CPU (was 34.7 %) | TODO |
| E12b | play a video with `zen.workspace.zentral.video_preview.enabled` = false, then true; D10 each | browser MainThread | TODO |
| E13 | `dom.ipc.processCount` = 2 and `dom.ipc.processPrelaunch.fission.number` = 1, restart, D1 | number of `web` processes (~11) and total MB | TODO |
| E14 | unload the idle YouTube tab, D1 | freed MB (expect ~1.1 GB) | TODO |
| E15 | right after a restart, BEFORE opening any console, read the largest zen.exe in Task Manager (private working set); then open a fresh console and run D1 | is the 1.4–1.56 GB startup parent value real or inflated by the console | TODO |
| E2 | `arc-findbar-blur` = 0px and `arc-menu-opacity` = false | GPU-process CPU | TODO (low priority) |
| E3 | turn the Transparent Zen mod off, restart, D2 | GPU-process CPU | TODO (low priority) |
| E6 | `zen.workspace.zentral.widgets.clock.show_seconds` = false | browser CPU | TODO (low priority) |
| G1 | Game session test (section 5) | RAM freed, stutter | after Boost exists |

## 5. Game session protocol (for when Boost is built)
1. Close nothing. Note Task Manager: total RAM used, committed memory, `zen.exe` total.
2. Start the game; note stutter points (alt-tab, loading screens) and RAM/commit at the worst moment.
3. Alt-tab, press Boost (light), then deep, then Game Mode; after each, note RAM freed (Boost toast) and whether the game stutters less.
4. Record: game, RAM before/after, commit before/after, which Boost level helped, whether Restore worked.
5. Windows side to check once: page file is system-managed or at least 1.5 × RAM (low commit makes games and the browser fight), Windows Game Mode is on.

## 6. Browser and Windows preferences for this owner

Status: **already applied by the owner** — `dom.ipc.processPriorityManager.backgroundUsesEcoQoS` = true, debug flags off. The rest is pending and applied one at a time here (about:config, restart where needed).

**Concrete values (from D6, Zen 1.24.1b / Firefox 159).** Apply one at a time; tick them off here.

| Pref | Now | Set to | Risk |
|---|---|---|---|
| `dom.ipc.processPriorityManager.backgroundUsesEcoQoS` | false [USER] | `true` | SAFE, helps games — **APPLIED** |
| `browser.low_commit_space_threshold_mb` | 200 | `3072` | TRADEOFF: tabs unload earlier when system memory is tight (what you want while gaming) |
| `image.mem.surfacecache.max_size_kb` | 2072576 | `262144` | SAFE |
| `gfx.canvas.accelerated.cache-items` | 8192 | `2048` | SAFE |
| `gfx.canvas.accelerated.cache-size` | 256 | `128` | SAFE |
| `browser.cache.memory.capacity` | -1 | `65536` | SAFE |
| `browser.cache.memory.max_entry_size` | 5120 | `2048` | SAFE |
| `browser.sessionhistory.max_total_viewers` | -1 | `2` | TRADEOFF (fewer instant back/forward pages) |
| `media.memory_caches_combined_limit_kb` | 524288 | `262144` | TRADEOFF (smaller in-RAM video buffer) |
| `browser.sessionstore.interval` | 40000 | `60000` | SAFE |
| `browser.sessionstore.max_tabs_undo` | 25 | `10` | SAFE |
| `browser.tabs.min_inactive_duration_before_unload` | 600000 | `300000` | SAFE |
| `browser.newtab.preload` | true | `false` | SAFE |
| `browser.urlbar.speculativeConnect.enabled` | true | `false` | SAFE |
| `dom.ipc.processPrelaunch.fission.number` | 3 | `1` | SAFE |
| `dom.ipc.processCount` | 8 | `2` | SAFE-ish (less crash isolation between non-isolated pages). Directly attacks the ~11 Notes pseudo-tab processes; test E13 |
| `fission.webContentIsolationStrategy` | 1 | `2` | **OWNER GATE** (less site isolation; measure process count with D1 before/after) |
| `zen.workspace.zentral.debug.core` | true | `false` | SAFE — **APPLIED** |
| `zen.workspace.zentral.modules.logger.enabled` | true | `false` (restart) | owner decision (section 8, item 1) |

Already fine, do not touch: telemetry/ping/normandy off, `network.prefetch-next`, `network.dns.disablePrefetch`, `network.http.speculative-parallel-limit=0`, `browser.sessionstore.restore_on_demand`, `restore_pinned_tabs_on_demand`, `browser.tabs.unloadOnLowMemory`, `browser.tabs.hoverPreview.enabled=false`, `dom.min_background_timeout_value`, `window_occlusion_tracking`, `dom.ipc.processPriorityManager.enabled`. Prefs that do NOT exist on this build (do not set): `dom.ipc.keepProcessesAlive.web`, `browser.low_commit_space_threshold_percent`, `memory.free_dirty_pages`, `media.suspend-bkgnd-video.*`, `browser.pagethumbnails.capturing_disabled`, `network.predictor.enabled`, `ui.prefersReducedMotion`. No `zen.tab-unloader.*` prefs exist either.


## 7. Parked items (decided by the data above; they become coding-agent tasks only if a test proves them)

| Item | Becomes a task if |
|---|---|
| Video preview CPU (`requestVideoFrameCallback`, smaller capture) | E12b shows the preview costs a lot of browser main-thread CPU while a video plays |
| CSS/blur audit (Arc, Transparent Zen) | E2/E3 show a clear GPU-process CPU drop |
| Idle tab auto-unloader | tabs are rarely loaded (6 of 45), so not needed unless D7 later shows many loaded idle tabs |
| Auto-boost when the browser is hidden | an owner request, after Boost works |
| Logger module default off | owner decides (he may need it for bug reports) |
| `fission.webContentIsolationStrategy` 1 → 2 | owner accepts weaker site isolation; measure process count first |
| Add-on removal | not needed (all small except uBlock 52 MB, which is worth it) |

## 8. Decisions the owner still has to make
1. Keep the logger module loaded at startup? (default is on; costs a little memory and some console noise)
2. Accept `fission.webContentIsolationStrategy = 2` (fewer processes, weaker site isolation)?
3. Clock seconds in the widget: keep (one DOM update per second while visible) or drop?
4. Which essential panels may sleep in Boost level 2 (default: none until set per panel), and whether the stronger saver may sleep WhatsApp/Messenger.

## 9. Command library (Browser Console)
Open Browser Console: `Ctrl+Shift+J` (needs `devtools.chrome.enabled = true`). Paste ONE command, press Enter, then paste the clipboard into the chat. Every command copies its result to the clipboard.

**D1 — RAM per process (do it twice: fresh start, and after a normal work session)**
```js
(async()=>{const p=await ChromeUtils.requestProcInfo();const rows=[];for(const x of [p,...p.children])rows.push({pid:x.pid,type:x.type,mb:Math.round(x.memory/1048576),cpu_s:Math.round((x.cpuTime||0)/1e9),origin:x.origin||"",tabs:(x.windows||[]).map(w=>(w.documentTitle||w.documentURI?.spec||"").slice(0,50)).join(" | ")});rows.sort((a,b)=>b.mb-a.mb);const out="TOTAL_MB="+rows.reduce((s,r)=>s+r.mb,0)+"\n"+rows.map(r=>[r.pid,r.type,r.mb+"MB",r.cpu_s+"s",r.origin,r.tabs].join("\t")).join("\n");Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out;})()
```

**D2 — CPU per process over 10 seconds (leave the browser idle while it runs)**
```js
(async()=>{const snap=async()=>{const p=await ChromeUtils.requestProcInfo();const m=new Map();for(const x of [p,...p.children])m.set(x.pid,x);return m;};const a=await snap();await new Promise(r=>setTimeout(r,10000));const b=await snap();const rows=[];for(const [pid,x] of b){const y=a.get(pid);if(!y)continue;rows.push({pid,type:x.type,cpu:+(((x.cpuTime-y.cpuTime)/1e9)/10*100).toFixed(1),mb:Math.round(x.memory/1048576),origin:x.origin||"",tabs:(x.windows||[]).map(w=>w.documentTitle||"").join(" | ").slice(0,70)});}rows.sort((p,q)=>q.cpu-p.cpu);const out=rows.map(r=>[r.pid,r.type,r.cpu+"%cpu(1 core=100)",r.mb+"MB",r.origin,r.tabs].join("\t")).join("\n");Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out;})()
```

**D3 — Memory by area: browser process, extension process, per-add-on, mod script sources** (replaces the first D3, which returned only address-space noise)
```js
(async()=>{const mgr=Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);const A=new Map(),B=new Map(),C=new Map(),S=[];const add=(m,k,v)=>m.set(k,(m.get(k)||0)+v);await new Promise(res=>mgr.getReports((proc,path,kind,units,amount)=>{if(units!==0)return;const p=String(proc);const main=p==="";const ext=p.toLowerCase().startsWith("extension");if(!main&&!ext)return;if(!path.startsWith("explicit/"))return;const s=path.split("/");add(A,(main?"MAIN ":"EXT ")+s.slice(0,3).join("/"),amount);if(main)add(B,s.slice(0,5).join("/"),amount);if(s[1]==="add-ons"&&s[2])add(C,s[2],amount);if(path.includes("script-sources")&&amount>150000)S.push([amount,path]);},null,res,null,false));const top=(m,n)=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>(v/1048576).toFixed(1)+"MB\t"+k).join("\n");S.sort((a,b)=>b[0]-a[0]);const out="== by area (3 levels) ==\n"+top(A,45)+"\n\n== MAIN deep (5 levels) ==\n"+top(B,45)+"\n\n== add-ons ==\n"+top(C,30)+"\n\n== script sources >150KB ==\n"+S.slice(0,40).map(([a,p])=>(a/1048576).toFixed(2)+"MB\t"+p).join("\n");Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out.length+" chars copied";})()
```

**D4 — Zentral runtime snapshot (which features run, duplicates)**
```js
(()=>{const w=Services.wm.getMostRecentWindow("navigator:browser");const s={full:!!w.ZentralRuntime,standalone:!!w.__zentralStandaloneRuntime,snapshot:w.ZentralRuntime?.snapshot?.()};const out=JSON.stringify(s,(k,v)=>typeof v==="function"?undefined:v,1);Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out.length+" chars copied";})()
```

**D5 — Every pref the owner changed from default**
```js
(()=>{const out=[];for(const n of Services.prefs.getChildList("")){if(!Services.prefs.prefHasUserValue(n))continue;const t=Services.prefs.getPrefType(n);let v;try{v=t===32?Services.prefs.getStringPref(n):t===64?Services.prefs.getIntPref(n):Services.prefs.getBoolPref(n);}catch(e){v="?"}out.push(n+"="+String(v).slice(0,80));}out.sort();const s=out.join("\n");Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(s);return out.length+" prefs copied";})()
```

**D6 — Which candidate native prefs exist here, with current value** (list = every pref in Part B)
```js
(()=>{const L=["dom.ipc.processCount","dom.ipc.processCount.webIsolated","fission.webContentIsolationStrategy","dom.ipc.keepProcessesAlive.web","dom.ipc.processPrelaunch.fission.number","browser.newtab.preload","browser.tabs.unloadOnLowMemory","browser.tabs.min_inactive_duration_before_unload","browser.low_commit_space_threshold_mb","browser.low_commit_space_threshold_percent","browser.sessionhistory.max_total_viewers","browser.sessionhistory.max_entries","browser.cache.memory.capacity","browser.cache.memory.max_entry_size","image.mem.surfacecache.max_size_kb","media.memory_caches_combined_limit_kb","media.memory_cache_max_size","gfx.canvas.accelerated.cache-items","gfx.canvas.accelerated.cache-size","memory.free_dirty_pages","browser.sessionstore.interval","browser.sessionstore.max_tabs_undo","browser.sessionstore.restore_on_demand","browser.sessionstore.restore_pinned_tabs_on_demand","dom.min_background_timeout_value","dom.timeout.background_throttling_max_budget","dom.ipc.processPriorityManager.enabled","dom.ipc.processPriorityManager.backgroundUsesEcoQoS","widget.windows.window_occlusion_tracking.enabled","layout.frame_rate","media.suspend-bkgnd-video.enabled","media.suspend-bkgnd-video.delay-ms","browser.tabs.hoverPreview.enabled","browser.tabs.hoverPreview.showThumbnails","browser.pagethumbnails.capturing_disabled","toolkit.telemetry.enabled","toolkit.telemetry.unified","datareporting.healthreport.uploadEnabled","browser.ping-centre.telemetry","app.normandy.enabled","app.shield.optoutstudies.enabled","network.prefetch-next","network.dns.disablePrefetch","network.predictor.enabled","network.http.speculative-parallel-limit","browser.urlbar.speculativeConnect.enabled","ui.prefersReducedMotion"];const rows=[];for(const n of L){const t=Services.prefs.getPrefType(n);let v="(missing)";if(t){try{v=t===32?Services.prefs.getStringPref(n):t===64?Services.prefs.getIntPref(n):Services.prefs.getBoolPref(n);}catch(e){v="?"}}rows.push(n+"\t"+v+(t&&Services.prefs.prefHasUserValue(n)?"\t[USER]":""));}for(const n of Services.prefs.getChildList("zen.")){if(/unload|sleep|preload|preview|thumbnail|animat|restore|memory|idle/i.test(n)&&!n.startsWith("zen.workspace.zentral")&&!n.startsWith("zen.workspace.bgalazka")&&!n.startsWith("zen.workspace.apps")){const t=Services.prefs.getPrefType(n);let v;try{v=t===32?Services.prefs.getStringPref(n):t===64?Services.prefs.getIntPref(n):Services.prefs.getBoolPref(n);}catch(e){v="?"}rows.push(n+"\t"+v+"\t[zen]");}}const s=rows.join("\n");Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(s);return rows.length+" rows copied";})()
```

**D7 — Tab census (loaded vs unloaded, pinned, audible, oldest)**
```js
(()=>{const w=Services.wm.getMostRecentWindow("navigator:browser");const T=[...w.gBrowser.tabs];const n=(f)=>T.filter(f).length;const rows=T.filter(t=>!t.hasAttribute("pending")).sort((a,b)=>a.lastAccessed-b.lastAccessed).slice(0,40).map(t=>Math.round((Date.now()-t.lastAccessed)/60000)+"min\t"+(t.pinned?"pinned ":"")+(t.hasAttribute("zen-essential")?"essential ":"")+(t.soundPlaying?"AUDIBLE ":"")+"\t"+(t.label||"").slice(0,50)+"\t"+(()=>{try{return t.linkedBrowser.currentURI.host}catch(e){return ""}})());const out="tabs="+T.length+" loaded="+n(t=>!t.hasAttribute("pending"))+" unloaded="+n(t=>t.hasAttribute("pending"))+" pinned="+n(t=>t.pinned)+" essential="+n(t=>t.hasAttribute("zen-essential"))+" audible="+n(t=>t.soundPlaying)+"\n"+rows.join("\n");Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out;})()
```

**D8 — How much does a plain "minimize memory" free? (decides the value of Boost level 1)**
```js
(async()=>{const tot=async()=>{const p=await ChromeUtils.requestProcInfo();return Math.round([p,...p.children].reduce((s,x)=>s+x.memory,0)/1048576);};const before=await tot();const mgr=Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);await new Promise(r=>mgr.minimizeMemoryUsage(r));await new Promise(r=>setTimeout(r,3000));const after=await tot();const out="before="+before+"MB after="+after+"MB freed="+(before-after)+"MB";Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out;})()
```

**D9 — Installed add-ons (each costs RAM in the extension process)**
```js
(async()=>{const {AddonManager}=ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");const a=await AddonManager.getAllAddons();const out=a.filter(x=>x.type==="extension"&&!x.isBuiltin&&!x.hidden).map(x=>x.name+"\t"+(x.isActive?"active":"off")+"\t"+x.version).join("\n");Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out;})()
```

**D10 — Which THREADS burn CPU (parent + GPU), 10 s, run while the browser is idle-ish**
```js
(async()=>{const snap=async()=>{const p=await ChromeUtils.requestProcInfo();const m=new Map();for(const x of [p,...p.children])for(const t of (x.threads||[]))m.set(x.pid+":"+t.tid,{pid:x.pid,type:x.type,name:t.name,cpu:t.cpuTime});return m;};const a=await snap();await new Promise(r=>setTimeout(r,10000));const b=await snap();const rows=[];for(const [k,t] of b){const y=a.get(k);if(!y)continue;const pct=((t.cpu-y.cpu)/1e9)/10*100;if(pct>=1)rows.push({pct,t});}rows.sort((p,q)=>q.pct-p.pct);const out=rows.slice(0,25).map(r=>r.pct.toFixed(1)+"%\t"+r.t.type+"\t"+r.t.pid+"\t"+r.t.name).join("\n");Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out;})()
```

**D11 — Which Sine mods are installed and enabled (many theme prefs in D5 may be leftovers)**
```js
(async()=>{const dir=PathUtils.join(Services.dirsvc.get("UChrm",Ci.nsIFile).path,"sine-mods");let out="";try{const j=await IOUtils.readJSON(PathUtils.join(dir,"mods.json"));out=Object.values(j).map(m=>(m.enabled===false?"OFF ":"ON  ")+(m.name||m.id)+" "+(m.version||"")).join("\n");}catch(e){out="mods.json failed: "+e+"\n"+(await IOUtils.getChildren(dir)).map(p=>PathUtils.filename(p)).join("\n");}Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out;})()
```

**D14 — Map extension UUIDs (seen in D3) to add-on names**
```js
(()=>{const out=WebExtensionPolicy.getActiveExtensions().map(p=>p.mozExtensionHostname+"\t"+p.name).join("\n");Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out;})()
```

**D15 — Is the Gecko Profiler running? (its buffer can be hundreds of MB; owner pref `devtools.performance.recording.entries` is 134217728)**
```js
Services.profiler.IsActive()
```
If it prints `true`, run `Services.profiler.StopProfiler()` and measure again.

## 10. Verification of Zentral 3.3.329 (OW-87 … OW-94) — what to run and what to expect

Review of the code: build check up to date, 256/256 tests pass. Gaps found are in `PLAN_CODING_AGENT_FOLLOWUP.md` (F1 panel tabs ignore their mode, F2 misleading pref name, F3 video source tab not exposed, F4 placeholders may look faded). Until F1 is merged, DO NOT turn on `boost.keep_pinned`: Level 2 would then unload WhatsApp and Messenger whatever their mode.

**D17 — Notes/Agenda placeholders: how many are parked**
```js
(()=>{const w=Services.wm.getMostRecentWindow("navigator:browser");const url=t=>{try{return String(t._zentralNotesUrl||t.linkedBrowser.currentURI.spec||"")}catch(e){return ""}};const P=[...w.gBrowser.tabs].filter(t=>/^about:blank#zn-/.test(url(t))||t.hasAttribute("bgalazka-notes-item")||t.hasAttribute("bgalazka-notes-agenda-item"));const out="placeholders="+P.length+" pending(parked)="+P.filter(t=>t.hasAttribute("pending")).length+" live="+P.filter(t=>!t.hasAttribute("pending")).length;Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(out);return out;})()
```

### Measurement protocol (same every time)
1. Restart the browser. Do NOT open any console for 3 minutes (the console itself uses memory).
2. At 3 min read Task Manager → Details → the largest `zen.exe` (private working set) = parent MB. Then open a fresh Browser Console and run D1, D17, D7, D4 in that order. Save the outputs in section 3.
3. Compare with the baselines: fresh restart on 3.3.307 = total 4114 MB, parent 1563 MB, ~11 `web` processes of 43–51 MB, WhatsApp 789, Messenger 549.

### Tests, in order

| # | Test | How | Pass when |
|---|---|---|---|
| V1 | Boost loaded | D4: `features` contains `boost` active, version 3.3.329; Settings has a **Memory** category | yes, no red console errors mentioning Zentral |
| V2 | OW-88 placeholders parked | after the 3-minute wait: D17 and D1 | `live` is 0 (or at most 1–2), `web` processes drop from ~11 to 1–3, total MB lower by roughly 0.3–0.5 GB |
| V3 | OW-88 behavior unchanged | click 3 notes and 2 Agenda items in the sidebar; create a note; restart once more | each opens, the previous tab stays selected, labels and icons kept, no blank tab, D17 shows them parked again after ~5 s |
| V4 | OW-88 look | compare the Notes rows with a screenshot taken on 3.3.307 | not greyed/faded, same spacing. If faded: that is follow-up F4 |
| V5 | OW-89 Boost light | open the Boost card in the widget tray, click it | toast "Freed X MB"; X is similar to the earlier D8 (0.5–0.8 GB); nothing closed or reloaded |
| V6 | OW-89 startup trim | restart, leave the browser untouched for ~2.5 min, then read Task Manager parent `zen.exe` | parent clearly below the earlier 1.4–1.56 GB start value (expected ~0.9–1.1 GB). Record before/after |
| V7 | OW-91 deep + Restore, safe version | with `boost.keep_pinned` left OFF: open 4 unpinned throwaway tabs, wait, run deep, then Restore | the throwaway tabs go pending, selected and audible tabs stay loaded, pinned tabs including WhatsApp/Messenger/arena stay loaded (this is today's behavior; arena cannot be slept until F1) |
| V8 | OW-93 throttled | right-click the arena.ai tile → Background mode: Throttled. Run D2 three times with arena hidden, then set it back to Live and repeat | arena content process CPU falls from ~11–40 % to near 0 % while throttled; opening the tile still loads the page normally |
| V9 | OW-94 Game Mode | play a video in the sidebar preview (or have Twitch audible), turn Game Mode on, wait 30 s, run D2 and D10, listen | audio and preview keep playing; every other process CPU near 0 %; turning it off restores the selected tab and everything reloads on click; Stronger saver stays OFF |
| V10 | OW-92 limiter, soft | set `boost.limit_enabled` true, `limit_mb` to ~500 below the current D1 total, mode `soft` | one toast offering "free now"; no tab touched; no repeat inside the cooldown (60 s) |
| V11 | Regression | WhatsApp and Messenger still receive messages; Notes, Calendar, Colorful folders, widgets, RSS, tab groups behave as before | no change |

### Result table to fill (copy each run into section 3)

| Metric | Baseline 3.3.307 | 3.3.329 | Change |
|---|---|---|---|
| Total MB (D1, 3 min after restart) | 4114 | | |
| Parent `zen.exe` (Task Manager, 3 min) | ~1563 (D1) | | |
| `web` process count (D1) | ~11 | | |
| Placeholders live / parked (D17) | all live | | |
| Light Boost freed MB (toast) | D8: 779 | | |
| arena.ai CPU % hidden: Live / Throttled (D2 ×3) | 11–40 | | |
| Game Mode: sum of CPU % of non-playing processes (D2) | – | | |


## 11. Owner-supplied D1 baseline (2026-11-19)

The owner supplied this baseline while asking the coding agent to continue. It is a **normal session** D1 reading,
not the after-sleep comparison required by the G1 owner gate. The procedure is now available in this repository;
run D1 again after sleeping WhatsApp/Messenger/arena.ai and compare the process rows and `TOTAL_MB` with this table.

`D1 after normal session: TOTAL_MB=5933`

```text
20076	webIsolated	1037MB	1079s	https://youtube.com^userContextId=1	about:blank | https://accounts.youtube.com/RotateCookiesPage?ori | Jeszcze Będzie Kolorowo | GTA 6 PL [#6] - YouTube | about:blank

14852	webIsolated	932MB	144s	https://chatgpt.com^userContextId=1	Fix Toggle Panel Autohide

24508	browser	782MB	3098s		

20720	webIsolated	723MB	319s	https://arena.ai^userContextId=1	Arena | Benchmark &amp; Compare the Best AI Models | about:blank | about:blank

26204	webIsolated	632MB	11s	https://claude.ai^userContextId=1	about:blank | Zen browser RAM optimization plan - Claude

7736	gpu	602MB	7955s		

25440	webIsolated	475MB	14s	https://arena.ai^userContextId=1	about:blank | Arena | Benchmark &amp; Compare the Best AI Models

17048	extension	270MB	70s		moz-extension://c606219e-a344-4c38-9a61-d4e4adfc6f | moz-extension://b54b43ba-04d3-4f55-beb2-f610e8c6f0 | moz-extension://c40771d9-f708-4b56-9320-30a71045b8 | moz-extension://0b432c71-17aa-4074-8a9c-eace4299f5 | moz-extension://2521a4b7-09f6-45a0-aa88-af31592e07 | moz-extension://136c5cd7-58b1-47cf-b84a-21d65ed9be | uBlock Origin Background Page | moz-extension://5ef05bb3-d32b-4f28-b9c9-9654d7d98b | Dark Reader background | moz-extension://6608ef37-fd5a-4661-aed3-c66f2a8f9e | moz-extension://17482d99-99c5-4c2b-be8b-e7b5a57da2 | moz-extension://70cf591f-ca1e-47a6-a14b-9229af1055 | moz-extension://53850133-42a8-4cbc-b2f0-1eb726a102 | moz-extension://2ec222cc-e3c1-4aa0-8e52-e55a7783e4 | moz-extension://2ffbf905-9540-4ce6-8c31-a3284bd7dd | moz-extension://f7264cd0-b46b-48c9-9f68-79e3263f32 | moz-extension://9a310967-e580-48bf-b3e8-4eafebbc12

23080	webIsolated	136MB	2s	https://google.com^userContextId=1	reCAPTCHA | about:blank | about:blank | reCAPTCHA

3840	webIsolated	76MB	1s	https://openai.com^userContextId=1	DIL Runner

20892	rdd	57MB	4s		

26372	webServiceWorker	42MB	2s	https://youtube.com^userContextId=1	

21104	web	39MB	1s		about:blank

25664	privilegedabout	26MB	0s		

19040	preallocated	26MB	0s		

16500	preallocated	26MB	0s		

7408	preallocated	26MB	0s		

15804	utility	9MB	78s		

15648	utility	9MB	0s		

7584	socket	8MB	0s
```
