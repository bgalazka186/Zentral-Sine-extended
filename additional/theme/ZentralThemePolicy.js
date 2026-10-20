/* Pure policy shared by theme-service and its tests; independent of Zentral. */
(function () {
  "use strict";
  function resolveTheme(
    policy,
    { browserDark = false, contentDark = false, systemDark = false } = {},
  ) {
    if (policy === "light") return "light";
    if (policy === "dark") return "dark";
    return (
      policy === "content"
        ? contentDark
        : policy === "system"
          ? systemDark
          : browserDark
    )
      ? "dark"
      : "light";
  }
  if (typeof module === "object" && module.exports)
    module.exports = { resolveTheme };
  if (typeof window !== "undefined")
    window.ZentralModuleLoader.define("theme-policy", () => ({ resolveTheme }));
})();
