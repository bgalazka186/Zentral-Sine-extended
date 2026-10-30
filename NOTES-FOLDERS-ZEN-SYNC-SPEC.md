# Notes folders, Zen-native NOTES folder, Zen Sync (Cycles D2 + E) - technical spec

Spec only. No code was changed. Status: **unverified in real Zen**; every "VERIFY" item needs a live check first.
Line numbers are from the 3.1.3 R1-R4 zip (`grep -n` the name if they drifted).
Read order for the implementer: this file, then `view` only the ranges named per phase.

## 0. Facts read from the code (do not re-research)

| Fact | Where |
| --- | --- |
| Host-folder pattern: real pinned `about:blank` tab -> `gZenFolders.createFolder([tab], {id, label, renameFolder:false, collapsed:true, workspaceId})`; fallback = plain pinned tab with `bgalazka-addon-host-fallback` | `ZentralBrowserIntegrations.uc.js` 850 (`ADDON_HOST_FOLDER_ID="bgalazka-zentral-addon-hosts"`), 982 `putAddonHostTabInFolder`, 1036 `createAddonHostRecord` |
| Folder lookup + hide: `findAddonHostFolder` (id or `zen-folder[bgalazka-addon-host-folder="true"]`), `keepAddonHostFolderCollapsed` sets `folder.collapsed = !isAddonHostFolderVisible()` on a 0 ms timer; visibility pref `SHOW_ADDON_HOST_FOLDER` default false | 893-935 |
| Repair on `TabOpen/TabPinned/TabGroupCreate/zen-workspace-switched/activate` via coalesced 0 ms timer (no retry loop) | ~940-975 |
| `isAddonHostTab(tab)`: attrs `bgalazka-addon-host`, `bgalazka-addon-host-fallback`, or `tab.closest("#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']")` | 1459 |
| `ensureSafeSelectedTabForAddonHosts(exceptTab)`: reselect `lastNonAddonHostTab` / first visible ordinary tab / create a normal tab | 1543 |
| `installAddonHostSelectionGuards`: guards **setters** `gBrowser.selectedTab`, `tabContainer.selectedItem`, `tabContainer.selectedIndex`; a host tab selection is swallowed, `ensureSafe...` runs, then `showAddonHostPanel(tab)` -> `Zentral.Apps.openPanel(record.app)` on a 0 ms timer; whole install is atomic (any failure = undo all, feature off) | 1603-1660 |
| `skipSessionStore: true` is passed to `gBrowser.removeTab` for host tabs (creation failure ~1124, teardown ~1190) | |
| Drag guard: `dragover` capture handler drops host from `gZenViewSplitter._lastOpenedTab` | ~1690 |
| Folder context menu: `#zenFolderActions`, items injected **1500 ms after startup** with `MozXULElement.parseXULToFragment`, placed `.after("#context_zenFolderToSpace")`, handler reads `folderMenu.triggerNode?.closest("zen-folder")`; guarded by `#zentral-tabgroup-convert-folder-to-group` existence | `ZentralGroupsMenus.js` 290-326 (`addFolderContextMenuItems`) |
| Tab context menu: `#tabContextMenu`, flag `_zentralEnhanced`; Zen rebuilds native items, so never `.remove()` natives, only hide with CSS | `ZentralGroupsMenus.js` 327-345 (`enhanceTabContextMenu`) |
| Notes on disk: one `<id>.md` per note, front matter keys `id, created, updated, color, label, pinned, trashed` (`FRONT_KEYS`, `parseNoteText` ~200, `noteFromFile` ~222, `serializeNote` 239); `meta.json` = `DEFAULT_META {lastNoteId,size,mode,highlight,syncScroll,pinned,geo,recent}` (2116), whitelisted per key in `loadMeta` (2133) | `ZentralNotes.uc.js` |
| Sheet sizes: `meta.size` in `peek|full|span`; `span` = hold-to-fill rectangle around every visible page of the panel (`createBarAdapter.baseArea({span:true})`, ~4846) | |
| Zen Sync exists (2026): Settings > Sync > "Sync your Spaces across devices"; syncs workspaces, containers, **pinned tabs, folders (label, icon, position, workspace)**, optional normal tabs (tab URL, title, icon, workspace/folder). Built on Firefox Sync records (PR zen-browser/desktop#12531, release notes). Exact pref names, record schema and size limits are NOT documented in what was read | VERIFY (section 4.1) |

## 1. Clean UI architecture (Cycle D2 -> E)

Principle: the in-sheet tree is the source of truth and works with **no** Zen folder. The Zen-native `NOTES` folder is an optional *projection* (pref `notes.zen_folder`, default off). Turning it off removes the projection only, never notes.

### 1.1 Data model (D2, pure functions first, tests in new `tests/notes-tree.test.cjs`)
- New front-matter key `folder:` (value = folder path id, e.g. `work/clients`, ASCII `[a-z0-9-]` segments joined by `/`, max depth 4, max 40 chars per segment). Add to `FRONT_KEYS`, `noteFromFile` (`folder: cleanFolder(meta.folder)`), `serializeNote` (emit only when non-empty). Unknown/invalid -> `""` (root). Notes without the key keep working (no migration).
- Folder list (labels, order, collapsed) lives in `meta.json`: `folders: [{id, label, order, collapsed}]`, whitelisted in `loadMeta` + `DEFAULT_META.folders = []` (max 64 folders, label <= 60 chars). A folder exists if listed OR if any note references it (auto-heal on load; label = last segment).
- Pin stays independent: a pinned note is also listed in a virtual "Pinned" row on top of the tree regardless of folder (existing `pinned` key).
- Pure helpers (exported next to `serializeNote` in the test export list, ~2549): `cleanFolder`, `buildTree(notes, folders) -> {id,label,children,notes}`, `moveNote(note, folderId)`, `renameFolder`, `deleteFolder(id, mode:"toRoot"|"toTrash")`.
- Store API additions in `createStore` (~2101): `setFolder(noteId, folderId)`, `addFolder/renameFolder/removeFolder`, emits `{type:"tree"}` (listeners already exist via `emit`). Writes go through the existing `queue`/dirty path; folder rename = meta write only (no note rewrite) unless a path id changes.

### 1.2 In-sheet UI (D2)
- List view: indented tree with chevrons (`aria-expanded`), per-folder "+" (New note here), drag note onto folder (reuse hold/drag helpers), keyboard: Left/Right collapse/expand, Enter open, F2 rename.
- Each folder row menu (uses existing `.zn-menu`): New note here, New subfolder, Rename, Delete (confirm via existing `askConfirm`), Move to...
- Cheap at idle: tree redrawn only on `emit` events; no observers.

### 1.3 Zen-native `NOTES` folder (E, new module file `extension/panels/browsers/ZentralNotesFolder.js` or section next to host-folder code; follow the host-folder lifecycle exactly)
Constants: `NOTES_FOLDER_ID = "bgalazka-zentral-notes"`, label `NOTES`, folder attr `bgalazka-notes-folder="true"`, item tab attr `bgalazka-notes-item="<noteId>"`, subfolder attr `bgalazka-notes-subfolder="<folderId>"`, action-row attr `bgalazka-notes-new="<folderId>"`.

Structure (Zen folders may nest; VERIFY `createFolder` accepts `parentId`/`gZenFolders` nesting API, else fall back to flat `NOTES/<sub> note` labels):
```
NOTES                      zen-folder, UNHIDDEN (collapsed:false allowed; never keepAddonHost...Collapsed)
  + New note               pinned about:blank#zn-new (action row, see 1.4)
  Pinned notes ...
  <subfolder>              nested zen-folder (attr bgalazka-notes-subfolder)
    + New note             action row inside the subfolder
    <note title>           pinned about:blank#zn1:<id>... (item)
```
Build/repair (copy the host pattern, steps in order):
1. `findNotesFolder()` = clone of `findAddonHostFolder` with the new id/attr.
2. `ensureNotesFolder()`: if missing -> create one pinned `about:blank` tab via `gBrowser.addTab("about:blank",{skipAnimation:true, triggeringPrincipal: systemPrincipal})`, mark `bgalazka-notes-item` **before** pin/createFolder (same "mark first" rule as `putAddonHostTabInFolder`), `gZenFolders.createFolder([tab],{id,label:"NOTES",renameFolder:false,collapsed:false,workspaceId})`; on failure fall back to plain pinned tab with `bgalazka-notes-fallback` and let the 0 ms repair timer retry on the same event list (no polling).
3. `syncTree()`: diff `buildTree()` against folder children by `bgalazka-notes-item` / `-subfolder` attrs; add/remove/relabel only the differences; label = `titleOf(body)` (<= 80 chars). Triggered by store `tree` / note title changes (debounced 250 ms), `zen-workspace-switched`, and sync-applied (section 4.4). Never touches tabs without our attrs.
4. Workspace scope: create in the active workspace only; pref `notes.zen_folder_workspace` = `active|all` (default `active`).
5. Cleanup registers: remove listeners, clear timers, `removeSelectionGuards` hook (below). Disabling the pref: remove item tabs with `gBrowser.removeTab(tab,{animate:false, skipPermitUnload:true, skipSessionStore:true})` then `folder.delete()` (as `convertFolderToGroup` does). Notes files untouched.

### 1.4 Click behaviour: open note expanded over the last Zentral panel
Selection-guard integration (the only change to the guarded path, and it must stay fail-closed):
- Do **not** add a second guard install. Generalise the existing one: add a registry `hostActivators = new Map()` (`kind -> fn(tab)`), extend `isAddonHostTab(tab)` with `tab.hasAttribute("bgalazka-notes-item") || tab.hasAttribute("bgalazka-notes-fallback") || tab.closest("[bgalazka-notes-folder='true']") || isNotesUrl(tab)` where `isNotesUrl` = `tab.linkedBrowser?.currentURI?.spec` (or `tab._zentralNotesUrl` cached at adoption) matches `/^about:blank#zn(1:|-new)/`. The URL test is what protects tabs that arrive from another device before we adopted them.
- In `guardedSet`, `showAddonHostPanel(tab)` becomes `activateHostTab(tab)`: `notes-item` -> `Zentral.Notes.openFromFolder({noteId, mode:"full"})`; `notes-new` -> `Zentral.Notes.openFromFolder({newInFolder: folderId})`; everything else -> existing `Apps.openPanel`. Still `ctx.setTimeout(...,0)`, still after `ensureSafeSelectedTabForAddonHosts(tab)`.
- `Zentral.Notes.openFromFolder(opts)` (new, in `ZentralNotes.uc.js`, next to `createBarAdapter` consumers ~5343): 1) pick host = last-used Zentral panel (`Zentral.Apps.lastPanelId` or the panel root attr `zentral-app-panel-open`; if Triple View is active use the slot that was last focused) 2) if none open: open the **fake blank panel** = a synthetic, non-persisted app record `{id:"zentral-notes-blank", url:"about:blank", name:"Notes", ephemeral:true}` through `Zentral.Apps.openPanel` (VERIFY ZentralAppModel accepts ephemeral records; otherwise create it with the same code path as `createAddonHostRecord`, never persisted, removed on close with `skipSessionStore:true`) 3) `store.setMeta({size:"span"})` (= fully expanded, same as holding the expand button; `span` is not persisted for the next normal open: restore previous size on close) 4) `sheet.open(noteId)`.
- Reuse, do not rebuild: panel autohide/hover (`ZentralPanelHover.js`), push/squeeze (`--zentral-notes-panel-reserve` + `zentral-notes-reserve` event in `ZentralPanelGeometry.uc.js` 544-653, being reworked by V4-R1), docking (`ZentralPanelPosition.js`). Notes must obey the V4 slot model (handoff section 19).
- Safety property to test: after any activation, `gBrowser.selectedTab` is an ordinary tab and `document.querySelector("tab[selected]")` is not a notes tab (extend the tests used for host tabs in `tests/standalone.test.cjs` style with a fake `gBrowser`).

### 1.5 RMB menus (inject with the existing pattern; never remove natives)
Injection points: `#zenFolderActions` for folders, `#tabContextMenu` for items. Reuse `ZentralGroupsMenus.js` timing (`setTimeout 1500` + `parseXULToFragment` + one `command` listener via `lifecycle.listen`), but show/hide our items in a `popupshowing` listener (capture the trigger: `menu.triggerNode.closest("zen-folder")` for folders, `TabContextMenu.contextTab` for tabs) so items appear only for notes targets; hide natives that would break the model (Rename folder, Convert to Space, Convert to Group, Unpin, Close, Duplicate, Move to workspace) with `[hidden]` driven by CSS attr selectors `:root[zentral-notes-ctx="item"] #context_...` set in `popupshowing`, removed in `popuphidden`.

| Target | Items (id prefix `zentral-notes-`) |
| --- | --- |
| NOTES root folder (`zen-folder[bgalazka-notes-folder]`) | `new-note` New note, `new-folder` New subfolder, `open-notes` Open Notes, separator, `rebuild` Rebuild tree from files, `hide-folder` Turn the NOTES folder off |
| Subfolder (`[bgalazka-notes-subfolder]`) | `new-note`, `new-folder`, `rename-folder` (prompt via existing dialog helper), `delete-folder` (confirm), `move-folder` |
| Note item (`tab[bgalazka-notes-item]`) | `open` Open, `open-full` Open expanded, `rename` (edits first line / label), `pin` Pin to top, `move` Move to folder > (submenu from `buildTree`), `duplicate`, `trash` (soft: sets `trashed`, uses existing trash), `copy-link` (`[[title]]` once D3 exists) |
| Action row (`bgalazka-notes-new`) | only `new-note`; all native items hidden |
All handlers call `Zentral.Notes.*` (no Notes logic in the menu file). Folder drag/drop onto/out of NOTES: block with the existing `dragover` pattern + `dragend` re-sync (`syncTree`), so a user cannot drop ordinary tabs into NOTES (VERIFY drop events: cancel in capture phase on `zen-folder[bgalazka-notes-folder]` when the dragged tab lacks our attr).

## 2. Cycle plan

| Phase | Content | Tests |
| --- | --- | --- |
| D2a | 1.1 data model + `buildTree` + store API | new `notes-tree` |
| D2b | 1.2 in-sheet tree UI; "recent" polish | `notes-tree`, `notes-ui` |
| E-a | 1.3 folder build/repair (flag off by default) | new `notes-zenfolder` (fake DOM/gBrowser from `tests/helpers/fake-dom.cjs`) |
| E-b | 1.4 activation + guard generalisation | `notes-zenfolder`, existing host-tab tests |
| E-c | 1.5 menus | `notes-zenfolder` |
| E-d | section 4 sync tier, **off by default** until 4.1 verified live | `notes-sync` |

## 3. State keys / prefs
`zen.workspace.zentral.notes.zen_folder` (bool, false), `...zen_folder_workspace` (`active|all`), `...zen_sync` (bool, false; requires zen_folder), `...zen_sync_max_bytes` (int, 700, range 200-1500, hidden from UI). DOM attrs: section 1.3. `meta.json`: `folders[]`. Note key: `folder`. Tab expando: `tab._zentralNotesUrl`.

## 4. Zen Sync integration and safety

### 4.1 What must be verified live first (cannot be known from the repo)
Open `about:config`, filter `zen.sync`, `services.sync.engine`, `services.sync.prefs.sync.zen`; read `resource://services-sync/` prefs `services.sync.client.*`; call `Weave.Service.engineManager` list in Browser Console to find the Zen engine name; read the server limits from the `info/configuration` response (`max_record_payload_bytes`, `max_post_bytes`) via `Weave.Service.recordsServer`/Browser Console; record them in the handoff. Until then use the conservative caps below (all caps are *ours*; they must be well under any server limit).
Also VERIFY: (a) are `about:blank#...` pinned tabs inside a folder written as records (url, title) unchanged? (b) is the title truncated? (c) does a hash fragment survive? (d) is a nested folder synced with its parent link? If (a)-(c) fail, sync tier stays off and notes stay local (the feature degrades to "no sync", never to broken tabs).

### 4.2 Wire format (tier "short note")
Carrier = one pinned tab per note inside the NOTES tree: `url = "about:blank#zn1:" + payload`, `title = clean title (<= 80 chars)`.
- `payload` = `base64url(utf8(json))` with json = `{"i":"<id>","u":<updated epoch ms>,"f":"<folderId>","c":"<color>","b":"<body>"}` plus checksum suffix `.` + 8 hex of CRC32(json bytes). Short keys, no whitespace.
- Limits (ours): `b` <= **700 UTF-8 bytes** (not chars: count bytes after encoding), whole URL <= **1400 ASCII chars**, title <= 80 chars, folder id <= 40, max **50** synced notes, max **200** chars of any label. Over the limit -> the note is local-only, shown with a "too long to sync" marker, never truncated silently.
- Encoding: UTF-8 only, base64url without padding (`-_`), NFC-normalised body, `\r\n` -> `\n`. No compression in v1 (keeps it debuggable; `CompressionStream` can be tier 2).
- Front-matter on the receiving side is rebuilt by `serializeNote`; the carrier never contains front-matter text.
- Longer notes: out of scope for Zen Sync. Fallback = Firefox Sync is not a file store; use the owner's own file sync on the notes folder (documented, not implemented).

### 4.3 Receive (strict, fail closed)
1. A new/changed tab appears (`TabOpen`, `TabPinned`, `zen-workspace-switched`, and the sync-applied hook of 4.4). `isAddonHostTab` already matches it by URL (1.4), so selection can never land on it, even before adoption.
2. `parseCarrier(url)`: whole-string regex `^about:blank#zn1:([A-Za-z0-9_-]{1,1400})\.([0-9a-f]{8})$`; length checks; base64url decode inside try/catch; CRC32 must match; JSON.parse inside try/catch; schema check: `i` matches `FILE_RE` id pattern, `u` integer within [2020-01-01, now+1 day], `f` passes `cleanFolder`, `c` in `NOTE_COLORS`, `b` string <= 700 bytes with no NUL. Anything else -> mark tab `bgalazka-notes-invalid`, **do nothing else**, never throw out of the handler.
3. Merge: if no local note with `i` -> create (file written through `store`, flagged `_fromSync`). If local exists: higher `u` wins; if the local note is newer or has unsaved edits (`dirty`) -> keep local, push local to the tab. Before overwriting a local note with different content, copy the old text to the existing `.bak` mechanism (`backedUp` set in `createStore`). Never delete a local note because a remote tab vanished; remote removal only unmarks `synced`.
4. Body is treated as plain Markdown text through the normal parser (the Markdown subset already blocks arbitrary HTML), so a hostile payload cannot run script.
5. Rate limit: max 20 imports per 10 s per window; excess is queued to one 1 s timer (no polling).

### 4.4 Send
Debounced 1500 ms after a note edit settles (reuse the store's autosave hook, not keystrokes): rebuild the carrier URL for that note; if over limits -> local-only; set `tab.linkedBrowser`'s URL **without loading** by changing the tab's saved state (VERIFY best API: `gBrowser.getBrowserForTab(tab)` is `about:blank`; prefer `SessionStore.setTabState`/`tab.setAttribute("label")` + `browser.loadURI`-free route; if only `loadURI("about:blank#zn1:...")` works it is a same-document fragment navigation and loads nothing). Hook for "sync applied": observe the Zen sync-applied notification found in 4.1 (`Services.obs.addObserver`, removed in cleanup); if none exists use the existing `TabOpen/TabAttrModified` events.

### 4.5 Guards that must hold (checklist for the tests)
1. Feature flag chain: `zen_sync` needs `zen_folder`; both default false; any exception in any notes-folder code path calls `disableNotesFolderRuntime()` (stops listeners, leaves existing tabs as inert `about:blank` pinned tabs) and logs once.
2. Notes tabs are **always** `isAddonHostTab` (attr OR folder ancestor OR URL pattern). Selection setters are guarded before any attribute/panel change (existing design, 1603).
3. Never call `gBrowser.removeTab` on a tab without our attr/URL; every removal passes `skipSessionStore:true` (matches host-tab code) except user-initiated "Delete note", which uses default session behaviour so Zen Sync sees the deletion.
4. Never write to Zen sync prefs or `services.sync.*` ourselves. Only read them. We do not register a Sync engine; we only produce/consume ordinary tabs.
5. No change to `services.sync.prefs.sync.zen.*` defaults. No change outside notes-owned tabs. Sync off by Zen -> notes stay local, nothing breaks.
6. Size/format limits of 4.2 enforced on both send and receive; invalid -> ignore, never repair destructively.
7. Idempotent: `syncTree()` and `adopt()` can run any number of times with the same result; no timers except the coalesced 0 ms repair timer, the 250 ms tree debounce, the 1500 ms send debounce and the 1 s import queue.
8. Test matrix (Node, fake DOM): valid / oversize / bad CRC / bad base64 / bad JSON / wrong id / future `u` / duplicate id / older remote / newer remote / dirty local / guard install failure / folder creation failure / sync pref off. Each must leave `gBrowser.selectedTab` ordinary and notes files unchanged except the intended one.
Honest limit: "100 %" cannot be proven from static code. The design is fail-closed with a kill switch and default-off sync; the acceptance gate is the live checklist in the handoff (section 19, "Live checks").

## 5. Token-cheap implementation order
D2a -> D2b -> E-a (flag off) -> E-b -> E-c -> live check -> E-d. One phase per session; each phase reads only its own section here plus the named line ranges.
