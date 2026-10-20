/*
 * ZENTRAL FILE GUIDE - extension/settings/controllers/ZentralSettingsCatalog.js
 *
 * Purpose: Combines available owner descriptors into settings schema/metadata and applies categories plus
 *   original preference order from extension/settings/layout.json.
 * Interaction / execution: Created by Runtime before feature activation. Runtime uses availability metadata
 *   to route settings; Shell/FeatureSettings/VideoSettings provide controls. Descriptor failures are
 *   isolated atomically by owner. Only successful owners and nonempty declared sections are published.
 * Ownership / failure: Data construction only. settingsOwners filters feature packages; descriptors
 *   preserve keys/defaults. layout.json is required UI metadata. No feature should start merely because its
 *   setting is listed.
 * Registration: settings-catalog
 * Loaded/created by: loader/ZentralRuntime.js
 * Direct local resource paths: zentral/apps/settings.json;
 *   extension/panels/browsers/settings.json; loader/settings.json;
 *   extension/panels/corner-tiles/settings.json; extension/settings/extension-settings.json;
 *   extension/panels/geometry/settings.json; additional/diagnostics/settings.json;
 *   extension/panels/styling/settings.json; extension/panels/navigation/settings.json;
 *   extension/panels/settings.json; additional/rss/settings.json;
 *   extension/panels/secondary-views/settings.json; additional/tabs/startup/settings.json;
 *   zentral/groups/settings.json; additional/tabs/unloading/settings.json;
 *   additional/video/settings.json; extension/settings/layout.json
 * Returned factory API: SETTINGS_ORGANIZATION; SETTINGS_SCHEMA
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("settings-catalog", function () {
    const loader = window.ZentralModuleLoader;
    const SETTINGS_SCHEMA = [],
      metadata = {},
      availableOwners = [];
    const layout = JSON.parse(
      loader.readText("extension/settings/layout.json", "settings"),
    );
    if (
      !Array.isArray(layout.categories) ||
      !Array.isArray(layout.order) ||
      layout.categories.some(
        (category) => !category.id || !Array.isArray(category.sections),
      )
    )
      throw new Error("Invalid settings category layout");
    const definitions = new Map(
      layout.categories.map((category) => [category.id, category]),
    );
    if (definitions.size !== layout.categories.length)
      throw new Error("Duplicate settings category");
    const descriptorFiles = [
      {
        owner: "panel-enhancements",
        file: "extension/panels/floating/settings.json",
      },
      { owner: "theme-service", file: "additional/theme/theme-settings.json" },
      { owner: "library-resize", file: "additional/library/settings.json" },
      {
        owner: "compact-hover",
        file: "additional/tabs/compact-hover/settings.json",
      },
      {
        owner: "apps",
        file: "zentral/apps/settings.json",
      },
      {
        owner: "panels",
        file: "extension/panels/settings.json",
      },
      {
        owner: "tab-groups",
        file: "zentral/groups/settings.json",
      },
      {
        owner: "corner-panels",
        file: "extension/panels/corner-tiles/settings.json",
      },
      {
        owner: "rss",
        file: "additional/rss/settings.json",
      },
      {
        owner: "geometry",
        file: "extension/panels/geometry/settings.json",
      },
      {
        owner: "secondary-views",
        file: "extension/panels/secondary-views/settings.json",
      },
      {
        owner: "panel-toolbar",
        file: "extension/panels/navigation/settings.json",
      },
      {
        owner: "startup",
        file: "additional/tabs/startup/settings.json",
      },
      {
        owner: "tab-drag",
        file: "additional/tabs/dragging/settings.json",
      },
      {
        owner: "tab-unload",
        file: "additional/tabs/unloading/settings.json",
      },
      {
        owner: "extension-settings",
        file: "extension/settings/extension-settings.json",
      },
      {
        owner: "panel-styles",
        file: "extension/panels/styling/settings.json",
      },
      {
        owner: "video",
        file: "additional/video/settings.json",
      },
      {
        owner: "browser-integrations",
        file: "extension/panels/browsers/settings.json",
      },
      {
        owner: "logger",
        file: "additional/diagnostics/settings.json",
      },
      {
        owner: "core",
        file: "loader/settings.json",
      },
    ];
    for (const { owner, file } of descriptorFiles) {
      if (loader.settingsOwners && !loader.settingsOwners.has(owner)) continue;
      try {
        const descriptor = JSON.parse(
          loader.readText(file, "settings:" + file),
        );
        if (
          descriptor.owner !== owner ||
          !Array.isArray(descriptor.schema) ||
          !descriptor.settings
        )
          throw new Error("Invalid owner descriptor: " + file);
        if (!descriptor.schema.length) continue;
        const incoming = new Set();
        for (const item of descriptor.schema) {
          const meta = descriptor.settings[item.property];
          const category = meta && definitions.get(meta.category);
          if (
            !item.property ||
            incoming.has(item.property) ||
            SETTINGS_SCHEMA.some((x) => x.property === item.property) ||
            !meta ||
            meta.owner !== owner ||
            !category ||
            !category.sections.some((section) => section.label === meta.section)
          )
            throw new Error("Invalid owner descriptor: " + file);
          incoming.add(item.property);
        }
        for (const item of descriptor.schema) {
          if (
            !item.property ||
            SETTINGS_SCHEMA.some((x) => x.property === item.property)
          )
            throw new Error("Duplicate or missing setting key in " + file);
          SETTINGS_SCHEMA.push({ ...item, feature: descriptor.owner });
          metadata[item.property] = descriptor.settings[item.property];
        }
        availableOwners.push(owner);
      } catch (error) {
        loader.fail?.(file, error, "descriptor");
        console.warn(
          "[Zentral settings] Owner descriptor unavailable:",
          file,
          error,
        );
      }
    }
    const order = new Map(
      layout.order
        .filter((x) => typeof x === "string")
        .map((key, index) => [key, index]),
    );
    SETTINGS_SCHEMA.sort(
      (a, b) =>
        (order.get(a.property) ?? Infinity) -
        (order.get(b.property) ?? Infinity),
    );
    const categories = layout.categories
      .map((category) => ({
        ...category,
        sections: category.sections
          .map((section) => ({
            ...section,
            properties: SETTINGS_SCHEMA.filter((item) => {
              const meta = metadata[item.property];
              return (
                meta?.category === category.id &&
                meta?.section === section.label
              );
            }).map((item) => item.property),
          }))
          .filter(
            (section) =>
              category.external ||
              category.virtual ||
              section.properties.length,
          ),
      }))
      .filter((category) => category.sections.length);
    return {
      SETTINGS_SCHEMA,
      SETTINGS_ORGANIZATION: {
        categories,
        settings: metadata,
        availableOwners,
      },
    };
  });
})();
