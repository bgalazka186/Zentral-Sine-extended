/* Zentral standalone embedded loader - TEMPLATE. Never loaded by the full pack.
 * tools/build-standalone.cjs inserts it into bundles whose manifest sets
 * "loader" (multi-file modules such as video).
 *
 * It implements the part of the full pack's window.ZentralModuleLoader contract
 * that those modules use: define, load, create, require, has, readText, rootURI,
 * sources, report, destroy. Differences, all deliberate:
 * - Sources are not read from disk. The build embeds each controller as a
 *   function and each content helper as a string, keyed by its repo path, so the
 *   paths the module already uses keep working. (eval/new Function are blocked
 *   in privileged windows, so sources are real code, not strings.)
 * - The loader is published under a PRIVATE global (__LOADER_GLOBAL__). The full
 *   pack's loader/Zentral.uc.js refuses to start when window.ZentralModuleLoader
 *   exists, so a standalone loader must never occupy that name.
 * - rootURI is the folder of the bundle script (where Sine put the package), so
 *   files that Gecko must read itself (the window actor) stay real files.
 */
const __zentralEmbeddedLoader = (function () {
  const sources = /*__SOURCES__*/ {};
  const texts = /*__TEXTS__*/ {};
  const definitions = new Map(),
    files = new Map(),
    sourceById = new Map(),
    components = new Map();
  let loadingSource = null,
    destroyed = false;
  // Same shape of check as the full loader: only embedded repo paths resolve.
  const safePath = (path) =>
    /^(?:additional)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.uc|\.sys)?\.(?:js|mjs|css|json)$/.test(
      path,
    );
  const rootURI = (() => {
    try {
      return Services.io.newURI("./", null, Services.io.newURI(__BUNDLE_URL__))
        .spec;
    } catch (error) {
      console.error("[Zentral standalone] cannot resolve install folder", error);
      return "";
    }
  })();
  const loader = {
    standalone: true,
    rootURI,
    define(id, factory) {
      if (definitions.has(id)) throw new Error("Duplicate component: " + id);
      definitions.set(id, factory);
      sourceById.set(id, loadingSource);
    },
    load(path, { optional = false, owner = "core" } = {}) {
      if (destroyed) throw new Error("Loader destroyed: " + path);
      if (!safePath(path) || !/\.(?:js|mjs)$/.test(path))
        throw new Error("Unsafe module path: " + path);
      const existing = files.get(path);
      if (existing?.state === "loaded") return true;
      if (existing?.state === "failed") {
        if (optional) return false;
        throw new Error(
          "Required source unavailable: " + path + ": " + existing.error,
        );
      }
      const run = sources[path];
      if (typeof run !== "function") {
        // Not part of this package (for example the Zentral settings UI).
        const error = "not included in the standalone package";
        files.set(path, { file: path, owner, phase: "load", state: "failed", error });
        if (optional) return false;
        throw new Error("Required source unavailable: " + path + ": " + error);
      }
      const row = { file: path, owner, phase: "load", state: "loading" };
      files.set(path, row);
      const previousSource = loadingSource;
      loadingSource = path;
      const priorDefinitions = new Set(definitions.keys());
      try {
        run(window);
        row.state = "loaded";
        return true;
      } catch (error) {
        for (const id of definitions.keys())
          if (!priorDefinitions.has(id) && sourceById.get(id) === path) {
            definitions.delete(id);
            sourceById.delete(id);
          }
        row.state = "failed";
        row.error = String(error) + (error?.stack ? "\n" + error.stack : "");
        console.error("[Zentral source]", path, error);
        if (!optional) throw error;
        return false;
      } finally {
        loadingSource = previousSource;
      }
    },
    readText(path, owner = "core") {
      if (!safePath(path)) throw new Error("Unsafe resource path: " + path);
      if (typeof texts[path] !== "string" || !texts[path])
        throw new Error("Resource unavailable: " + path);
      files.set(path, { file: path, owner, phase: "resource", state: "loaded" });
      return texts[path];
    },
    create(id, args, { optional = false } = {}) {
      const file = sourceById.get(id);
      try {
        const factory = this.require(id);
        if (typeof factory !== "function")
          throw new Error("Invalid factory: " + id);
        const value = factory(args);
        const component = components.get(id) || { id, file, constructions: 0 };
        component.state = "initialized";
        component.constructions++;
        delete component.error;
        components.set(id, component);
        return value;
      } catch (error) {
        components.set(id, { id, file, state: "failed", error: String(error) });
        const row = file && files.get(file);
        if (row) {
          row.state = "failed";
          row.phase = "factory";
          row.component = id;
          row.error = String(error) + (error?.stack ? "\n" + error.stack : "");
        }
        console.error("[Zentral component]", file || id, error);
        if (!optional) throw error;
        return null;
      }
    },
    require(id) {
      if (
        !definitions.has(id) ||
        files.get(sourceById.get(id))?.state === "failed"
      )
        throw new Error("Component did not register: " + id);
      return definitions.get(id);
    },
    has: (id) =>
      definitions.has(id) && files.get(sourceById.get(id))?.state !== "failed",
    sources: () => [...files.values()].map((row) => ({ ...row })),
    report() {
      return {
        standalone: true,
        sources: this.sources(),
        components: [...components.values()].map((row) => ({ ...row })),
      };
    },
    destroy() {
      destroyed = true;
      definitions.clear();
      components.clear();
      files.clear();
      sourceById.clear();
      if (window.__LOADER_GLOBAL__ === loader) delete window.__LOADER_GLOBAL__;
    },
  };
  return loader;
})();
