/* Mirrors new settings without new preference keys or duplicate feature owners.
 * Loaded by the settings host; duplicates use data-shortcut-key so the normal
 * category organizer never mistakes them for original rows. */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "release-lab",
    ({ schema, metadata, createRow, ensureCategory, available, runtime }) => {
      const keys = new Set(
        JSON.parse(
          window.ZentralModuleLoader.readText(
            "extension/settings/release-settings.json",
            "settings",
          ),
        ).keys,
      );
      function note(parent, id, text, links) {
        if (!parent || parent.querySelector("#" + id)) return;
        const box = document.createElement("p");
        box.id = id;
        box.className = "zs-category-description";
        box.append(document.createTextNode(text + " "));
        for (const [label, href] of links) {
          const a = document.createElement("a");
          a.textContent = label;
          a.href = href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          box.append(a, document.createTextNode(" "));
        }
        parent.append(box);
      }
      return {
        render(modal) {
          const target = ensureCategory(modal, "release-lab").content;
          for (const item of schema) {
            if (!keys.has(item.property)) continue;
            const existing = [
              ...target.querySelectorAll("[data-shortcut-key]"),
            ].find((x) => x.dataset.shortcutKey === item.property);
            if (existing) {
              const input = existing.querySelector("input,select");
              if (input) input.disabled = !available(item);
              continue;
            }
            const row = createRow(item, metadata(item));
            delete row.dataset.settingKey;
            delete row.dataset.schemaFallback;
            row.dataset.shortcutKey = item.property;
            const input = row.querySelector("input,select"),
              label = row.querySelector(".zs-label");
            input.disabled = !available(item);
            input.id =
              "zs-release-" + item.property.replace(/[^a-z0-9_-]/gi, "-");
            if (label) label.htmlFor = input.id;
            const origin = metadata(item);
            row.title =
              (input.disabled
                ? "Unavailable until its module is enabled and restarted. "
                : "") +
              "Original section: " +
              origin.category +
              " / " +
              origin.section;
            target.append(row);
          }
          const compat = modal.querySelector(
            "#zs-panel-organized-compatibility .zs-organized-content",
          );
          note(
            compat,
            "zentral-companion-notes",
            "I recommend Arc 2.0 for the Arc appearance options. I use oom333 Tab Groups with Zentral Groups disabled. Select the external-groups switch when using that mod. Library resizing and ZenLibraryTweaks can both own Library geometry; select only one layout owner.",
            [
              ["Arc 2.0", "https://github.com/YashjitPal/Arc-2.0"],
              ["Tab Groups", "https://github.com/oom333/zen-tab-groups"],
              [
                "ZenLibraryTweaks",
                "https://github.com/JustAdumbPrsn/ZenLibraryTweaks",
              ],
            ],
          );
          const groups = modal.querySelector(
            "#zs-panel-organized-tab-groups .zs-organized-content",
          );
          note(
            groups,
            "zentral-groups-recommendation",
            "I recommend and use oom333 Tab Groups, with Zentral Groups disabled. Zentral Groups remains available for other configurations.",
            [
              [
                "Recommended Tab Groups",
                "https://github.com/oom333/zen-tab-groups",
              ],
            ],
          );
          for (const row of modal.querySelectorAll("[data-setting-key]"))
            if (/arc.?2/i.test(row.dataset.settingKey)) {
              note(
                row.closest(".zs-category-segment") || row.parentElement,
                "zentral-arc-recommendation",
                "I recommend Arc 2.0. These options complement that mod; they do not install it.",
                [["Arc 2.0", "https://github.com/YashjitPal/Arc-2.0"]],
              );
              break;
            }
        },
      };
    },
  );
})();
