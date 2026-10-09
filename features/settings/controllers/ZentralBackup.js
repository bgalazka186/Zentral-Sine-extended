/*
 * ZENTRAL FILE GUIDE - features/settings/controllers/ZentralBackup.js
 *
 * Purpose: Optional appearance/settings backup export/import, validation and backup control construction.
 * Interaction / execution: FeatureSettings supplies schema and Appearance validation/defaults plus
 *   syncAppearanceAfterImport; import applies validated settings and asks collaborators to refresh.
 * Ownership / failure: Optional factory failure leaves settings available without backup controls. Do not
 *   silently import arbitrary preference names or mutate browser ownership during backup.
 * Registration: settings-backup
 * Loaded/created by: features/settings/controllers/ZentralFeatureSettings.js
 * Returned factory API: addLookBackupControls; exportBackup; importBackup
 * Shared ctx symbols used: BGALAZKA_EXT_PREFS; PROFILE_DEFAULTS; setPref
 * Cross-file calls / ctx suppliers: features/panels/ZentralPanels.uc.js -> ctx.BGALAZKA_EXT_PREFS, ctx.PROFILE_DEFAULTS,
 *   ctx.setPref
 * Literal DOM event subscriptions: click
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "settings-backup",
    function ({
      ctx,
      Services,
      SETTINGS_SCHEMA,
      LOOK_PREFS,
      LOOK_DEFAULTS,
      LOOK_KEYS,
      LOOK_COLORS,
      LOOK_ENUMS,
      LOOK_BOUNDS,
      LOOK_GROUP_PREFS,
      syncAppearanceAfterImport,
    }) {
      // Export only owned preference keys; reject arbitrary keys and malformed
      // data before applying anything. Import merges selected keys into this profile.
      // Core owns the base default table. Reading it through the exposed
      // instance avoids reaching across IIFE scope and tracks future base keys.
      const baseBackupKeys = () =>
        new Set(Object.keys(window.Zentral?.Core?.defaultPrefs || {}));
      let cachedBackupSchema = null;
      let cachedBackupSchemaLength = -1;
      const backupSchema = () => {
        // Registration appends settings. Rebuild only when new settings arrive.
        if (cachedBackupSchemaLength !== SETTINGS_SCHEMA.length) {
          cachedBackupSchema = new Map();
          for (const item of SETTINGS_SCHEMA)
            if (item.property) cachedBackupSchema.set(item.property, item);
          cachedBackupSchemaLength = SETTINGS_SCHEMA.length;
        }
        return cachedBackupSchema;
      };
      const backupColorKeys = new Set([
        ...LOOK_COLORS.map((name) => LOOK_PREFS[name]),
        ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
      ]);
      const backupDefault = (key) =>
        LOOK_DEFAULTS[key] ??
        ctx.PROFILE_DEFAULTS[key] ??
        window.Zentral?.Core?.defaultPrefs?.[key] ??
        backupSchema().get(key)?.defaultValue;
      const fullBackupKeys = () =>
        new Set([
          ...baseBackupKeys(),
          ...backupSchema().keys(),
          ...Object.keys(ctx.PROFILE_DEFAULTS),
          ...Services.prefs.getChildList("zen.workspace.bgalazka."),
          ...Services.prefs.getChildList(
            "zen.workspace.zentral.video_preview.",
          ),
          ...Services.prefs.getChildList("zen.workspace.zentral.modules."),
          ...LOOK_KEYS,
        ]);
      const ownedBackupKey = (key) =>
        LOOK_KEYS.has(key) ||
        Object.hasOwn(window.Zentral?.Core?.defaultPrefs || {}, key) ||
        backupSchema().has(key) ||
        key.startsWith("zen.workspace.bgalazka.") ||
        key.startsWith("zen.workspace.zentral.video_preview.") ||
        /^zen\.workspace\.zentral\.modules\.[\w.-]+\.enabled$/.test(key);
      async function chooseBackupFile(mode, title, defaultName) {
        const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
          Ci.nsIFilePicker,
        );
        picker.init(window.browsingContext || window, title, mode);
        picker.appendFilter("JSON files", "*.json");
        if (defaultName) picker.defaultString = defaultName;
        const result = await new Promise((resolve) => {
          let settled = false;
          const done = (value) => {
            if (!settled) {
              settled = true;
              resolve(value);
            }
          };
          try {
            const maybe = picker.open({ done });
            if (maybe?.then) maybe.then(done, () => done(null));
          } catch (_) {
            try {
              const maybe = picker.open(done);
              if (maybe?.then) maybe.then(done, () => done(null));
            } catch (_) {
              done(null);
            }
          }
        });
        return result === Ci.nsIFilePicker.returnOK ||
          result === Ci.nsIFilePicker.returnReplace
          ? picker.file?.path
          : null;
      }
      async function exportBackup(scope) {
        const prefs = {};
        for (const key of scope === "look" ? LOOK_KEYS : fullBackupKeys()) {
          const baseline = backupDefault(key);
          if (
            scope === "full" &&
            !Services.prefs.prefHasUserValue(key) &&
            baseline === undefined
          )
            continue;
          const type = Services.prefs.getPrefType(key);
          const fallback = baseline;
          try {
            prefs[key] =
              !Services.prefs.prefHasUserValue(key) && fallback !== undefined
                ? fallback
                : type === Services.prefs.PREF_BOOL
                  ? Services.prefs.getBoolPref(key)
                  : type === Services.prefs.PREF_INT
                    ? Services.prefs.getIntPref(key)
                    : type === Services.prefs.PREF_STRING
                      ? Services.prefs.getStringPref(key)
                      : fallback;
          } catch (_) {
            if (fallback !== undefined) prefs[key] = fallback;
          }
        }
        const path = await chooseBackupFile(
          Ci.nsIFilePicker.modeSave,
          "Export Zentral " + scope + " settings",
          "zentral-" +
            scope +
            "-" +
            new Date().toISOString().slice(0, 10) +
            ".json",
        );
        if (!path) return false;
        await IOUtils.writeUTF8(
          path,
          JSON.stringify(
            { format: "zentral-settings", version: 1, scope, prefs },
            null,
            2,
          ),
        );
        return true;
      }
      async function importBackup(scope) {
        const path = await chooseBackupFile(
          Ci.nsIFilePicker.modeOpen,
          "Import Zentral " + scope + " settings",
        );
        if (!path) return false;
        if ((await IOUtils.stat(path)).size > 16 * 1024 * 1024)
          throw new Error("Settings file is too large");
        const data = JSON.parse(await IOUtils.readUTF8(path));
        if (
          data?.format !== "zentral-settings" ||
          data.version !== 1 ||
          !["look", "full"].includes(data.scope) ||
          !data.prefs ||
          Array.isArray(data.prefs) ||
          typeof data.prefs !== "object"
        )
          throw new Error("Not a supported Zentral settings file");
        if (scope === "full" && data.scope !== "full")
          throw new Error("Choose a full settings export here");
        const entries = Object.entries(data.prefs);
        if (entries.length > 1500 || !entries.length)
          throw new Error("Invalid settings count");
        const requestedChanges = entries.filter(
          ([key]) => scope === "full" || LOOK_KEYS.has(key),
        );
        if (scope === "look" && !requestedChanges.length)
          throw new Error("No Look options in this file");
        for (const [key, value] of entries) {
          if (
            !ownedBackupKey(key) ||
            (data.scope === "look" && !LOOK_KEYS.has(key)) ||
            !["string", "boolean", "number"].includes(typeof value) ||
            (typeof value === "number" && !Number.isSafeInteger(value)) ||
            (typeof value === "string" && value.length > 8 * 1024 * 1024)
          )
            throw new Error("Invalid preference in settings file: " + key);
          const expected = backupDefault(key);
          // Older grid menus wrote numeric strings; keep these exports importable.
          const legacyGridValue =
            [
              "zen.workspace.apps.sidebar.apps_per_row",
              "zen.workspace.apps.sidebar.max_rows",
            ].includes(key) &&
            typeof value === "string" &&
            /^\d+$/.test(value);
          if (
            expected !== undefined &&
            typeof value !== typeof expected &&
            !legacyGridValue
          )
            throw new Error("Invalid preference type: " + key);
          const declared = backupSchema().get(key);
          if (
            declared?.options &&
            typeof value === "string" &&
            !legacyGridValue &&
            !declared.options.some((option) => option.value === value) &&
            value !== expected
          )
            throw new Error("Invalid preference option: " + key);
          if (
            typeof value === "number" &&
            (value < -2147483648 || value > 2147483647)
          )
            throw new Error("Preference integer out of range: " + key);
          if (LOOK_KEYS.has(key)) {
            const expected = LOOK_DEFAULTS[key];
            if (
              typeof value !== typeof expected ||
              (backupColorKeys.has(key) && !/^#[0-9a-fA-F]{6}$/.test(value)) ||
              (LOOK_ENUMS[key] && !LOOK_ENUMS[key].includes(value)) ||
              (LOOK_BOUNDS[key] &&
                (value < LOOK_BOUNDS[key][0] || value > LOOK_BOUNDS[key][1]))
            )
              throw new Error("Invalid Look value: " + key);
          }
        }
        const changes = requestedChanges.filter(([key, value]) => {
          if (!Services.prefs.prefHasUserValue(key)) return true;
          try {
            const type = Services.prefs.getPrefType(key);
            const existing =
              type === Services.prefs.PREF_BOOL
                ? Services.prefs.getBoolPref(key)
                : type === Services.prefs.PREF_INT
                  ? Services.prefs.getIntPref(key)
                  : type === Services.prefs.PREF_STRING
                    ? Services.prefs.getStringPref(key)
                    : undefined;
            return existing !== value;
          } catch (_) {
            return true;
          }
        });
        // Store original types as well: a malformed or interrupted write can be
        // rolled back without discarding an existing preference.
        const previous = new Map(
          changes.map(([key]) => {
            const hadUserValue = Services.prefs.prefHasUserValue(key);
            const type = Services.prefs.getPrefType(key);
            const value = hadUserValue
              ? type === Services.prefs.PREF_BOOL
                ? Services.prefs.getBoolPref(key)
                : type === Services.prefs.PREF_INT
                  ? Services.prefs.getIntPref(key)
                  : type === Services.prefs.PREF_STRING
                    ? Services.prefs.getStringPref(key)
                    : undefined
              : undefined;
            return [key, { hadUserValue, value }];
          }),
        );
        try {
          for (const [key, value] of changes) {
            if (
              previous.get(key).hadUserValue &&
              typeof previous.get(key).value !== typeof value
            )
              Services.prefs.clearUserPref(key);
            if (typeof value === "boolean")
              Services.prefs.setBoolPref(key, value);
            else if (typeof value === "number")
              Services.prefs.setIntPref(key, value);
            else Services.prefs.setStringPref(key, value);
          }
        } catch (error) {
          for (const [key, { hadUserValue, value }] of previous) {
            try {
              if (Services.prefs.prefHasUserValue(key))
                Services.prefs.clearUserPref(key);
              if (hadUserValue) ctx.setPref(key, value);
            } catch (_) {}
          }
          throw error;
        }
        for (const [key, value] of changes)
          window.Zentral?.Core?.emit(`config:${key}`, value);
        if (changes.some(([key]) => key.startsWith("zen.workspace.apps."))) {
          const apps = window.Zentral?.Apps;
          apps?.applyHideUtilitySectionPref?.();
          apps?.repositionGrid?.();
          apps?.updateAutohideState?.();
          apps?.renderGrid?.();
        }
        syncAppearanceAfterImport(changes.map(([key]) => key));
        return true;
      }
      function addLookBackupControls(container) {
        const heading = document.createElement("h4");
        heading.className = "zs-look-heading";
        heading.textContent = "Import & export";
        const note = document.createElement("p");
        note.className = "zs-look-note";
        note.textContent =
          "Look files contain appearance only. Full files contain Zentral settings and panel preferences; imported values merge with your current profile. Restart Zen for changes outside Look to take full effect.";
        const actions = document.createElement("div");
        actions.className = "zs-look-actions";
        for (const [label, action, scope] of [
          ["Export Look", exportBackup, "look"],
          ["Import Look", importBackup, "look"],
          ["Export all settings", exportBackup, "full"],
          ["Import all settings", importBackup, "full"],
        ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "zs-look-action";
          button.textContent = label;
          button.addEventListener("click", async () => {
            button.disabled = true;
            try {
              if (await action(scope)) window.alert(label + " complete.");
            } catch (error) {
              console.error("[Zentral] Settings transfer failed:", error);
              window.alert(label + " failed: " + error.message);
            } finally {
              button.disabled = false;
            }
          });
          actions.append(button);
        }
        container.append(heading, note, actions);
      }

      /* RSS sidebar display only. Zen owns fetching, tab creation, dismissal and
       * session state. This never moves or closes its tabs or folders. An empty
       * live folder can still contain Zen's restoration placeholder; only tabs
       * explicitly marked as placeholders may be ignored. No tabstrip subtree observer: that
       * pattern can crash Gecko during pinning (architecture note 4). */
      return { addLookBackupControls, exportBackup, importBackup };
    },
  );
})();
