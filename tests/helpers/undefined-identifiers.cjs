"use strict";
// Finds every reference to an identifier that no enclosing scope declares (the check ESLint calls `no-undef`).
// Such a reference is a ReferenceError the moment that line runs, and no behaviour test notices it until a person
// reaches that exact branch: a menu command that calls a function living in another closure, an error path that
// logs through a logger which exists one scope further out.
//
// The repository has no dependencies, so the parser is the copy of acorn that ships inside Node itself.
const vm = require("node:vm");

let parser = null;
function loadParser() {
  if (parser) return parser;
  let source = "";
  try { source = process.binding("natives")["internal/deps/acorn/acorn/dist/acorn"] || ""; } catch (_) {}
  if (!source) throw new Error("The JavaScript parser bundled with Node (acorn) is not reachable in this Node version; tests/helpers/undefined-identifiers.cjs needs another source for it");
  const module = { exports: {} };
  new Function("exports", "module", source)(module.exports, module);
  parser = module.exports;
  return parser;
}

// Names every JavaScript engine provides (Object, Promise, Intl, globalThis, undefined…). Read from a fresh context, so
// nothing that only Node has (process, Buffer, require) counts as "declared" for code that runs in the browser.
const LANGUAGE_GLOBALS = Object.freeze(vm.runInNewContext("Object.getOwnPropertyNames(globalThis)"));

class Scope {
  constructor(parent, isFunction) {
    this.parent = parent;
    this.names = new Set();
    this.varScope = isFunction || !parent ? this : parent.varScope; // where `var` and sloppy function declarations land
  }
  declares(name) {
    for (let scope = this; scope; scope = scope.parent) if (scope.names.has(name)) return true;
    return false;
  }
}

const SKIPPED_KEYS = new Set(["type", "loc", "start", "end", "range"]);

function findUndefinedIdentifiers(code, { globals = [], sourceType = "script" } = {}) {
  const ast = loadParser().parse(code, { ecmaVersion: "latest", sourceType, locations: true, allowHashBang: true, allowReturnOutsideFunction: sourceType === "script" });
  const known = new Set([...LANGUAGE_GLOBALS, ...globals]);
  const references = [];
  const reference = (node, scope) => references.push({ name: node.name, line: node.loc.start.line, column: node.loc.start.column + 1, scope });

  // A binding pattern declares its names in `scope`; default values and computed keys are ordinary expressions.
  function declare(node, scope, valueScope) {
    switch (node.type) {
      case "Identifier": scope.names.add(node.name); return;
      case "ObjectPattern":
        for (const property of node.properties) {
          if (property.type === "RestElement") { declare(property.argument, scope, valueScope); continue; }
          if (property.computed) visit(property.key, valueScope);
          declare(property.value, scope, valueScope);
        }
        return;
      case "ArrayPattern": for (const element of node.elements) if (element) declare(element, scope, valueScope); return;
      case "RestElement": declare(node.argument, scope, valueScope); return;
      case "AssignmentPattern": declare(node.left, scope, valueScope); visit(node.right, valueScope); return;
      default: visit(node, valueScope);
    }
  }
  // An assignment target (`a = 1`, `[a, b] = pair`, `for (key in map)`) reads no value but still needs the binding.
  function assign(node, scope) {
    switch (node.type) {
      case "Identifier": reference(node, scope); return;
      case "ObjectPattern":
        for (const property of node.properties) {
          if (property.type === "RestElement") { assign(property.argument, scope); continue; }
          if (property.computed) visit(property.key, scope);
          assign(property.value, scope);
        }
        return;
      case "ArrayPattern": for (const element of node.elements) if (element) assign(element, scope); return;
      case "RestElement": assign(node.argument, scope); return;
      case "AssignmentPattern": assign(node.left, scope); visit(node.right, scope); return;
      default: visit(node, scope);
    }
  }
  function visitFunction(node, outer) {
    const scope = new Scope(outer, true);
    if (node.type !== "ArrowFunctionExpression") scope.names.add("arguments");
    for (const parameter of node.params) declare(parameter, scope, scope);
    if (node.body.type === "BlockStatement") for (const statement of node.body.body) visit(statement, scope);
    else visit(node.body, scope);
  }
  function visit(node, scope) {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "Identifier": reference(node, scope); return;
      case "FunctionDeclaration":
        if (node.id) { scope.names.add(node.id.name); scope.varScope.names.add(node.id.name); }
        visitFunction(node, scope); return;
      case "FunctionExpression": {
        let outer = scope;
        if (node.id) { outer = new Scope(scope, false); outer.names.add(node.id.name); }
        visitFunction(node, outer); return;
      }
      case "ArrowFunctionExpression": visitFunction(node, scope); return;
      case "ClassDeclaration":
      case "ClassExpression": {
        if (node.type === "ClassDeclaration" && node.id) scope.names.add(node.id.name);
        visit(node.superClass, scope);
        const inner = new Scope(scope, false);
        if (node.id) inner.names.add(node.id.name);
        for (const member of node.body.body) visit(member, inner);
        return;
      }
      case "MethodDefinition":
        if (node.computed) visit(node.key, scope);
        visit(node.value, scope); return;
      case "PropertyDefinition":
      case "AccessorProperty": {
        if (node.computed) visit(node.key, scope);
        if (node.value) { const initializer = new Scope(scope, true); initializer.names.add("arguments"); visit(node.value, initializer); }
        return;
      }
      case "StaticBlock": { const block = new Scope(scope, true); for (const statement of node.body) visit(statement, block); return; }
      case "VariableDeclaration": {
        const target = node.kind === "var" ? scope.varScope : scope;
        for (const declarator of node.declarations) { declare(declarator.id, target, scope); visit(declarator.init, scope); }
        return;
      }
      case "BlockStatement": { const block = new Scope(scope, false); for (const statement of node.body) visit(statement, block); return; }
      case "ForStatement": {
        const head = new Scope(scope, false);
        visit(node.init, head); visit(node.test, head); visit(node.update, head); visit(node.body, head); return;
      }
      case "ForInStatement":
      case "ForOfStatement": {
        const head = new Scope(scope, false);
        if (node.left.type === "VariableDeclaration") visit(node.left, head); else assign(node.left, head);
        visit(node.right, head); visit(node.body, head); return;
      }
      case "SwitchStatement": {
        visit(node.discriminant, scope);
        const block = new Scope(scope, false);
        for (const branch of node.cases) { visit(branch.test, block); for (const statement of branch.consequent) visit(statement, block); }
        return;
      }
      case "CatchClause": {
        const handler = new Scope(scope, false);
        if (node.param) declare(node.param, handler, handler);
        visit(node.body, handler); return;
      }
      case "MemberExpression":
        visit(node.object, scope);
        if (node.computed) visit(node.property, scope);
        return;
      case "Property": // inside an object literal; patterns are handled by declare() and assign()
        if (node.computed) visit(node.key, scope);
        visit(node.value, scope); return;
      case "LabeledStatement": visit(node.body, scope); return;
      case "BreakStatement":
      case "ContinueStatement":
      case "MetaProperty":
      case "ExportAllDeclaration": return;
      case "AssignmentExpression": assign(node.left, scope); visit(node.right, scope); return;
      case "UpdateExpression": assign(node.argument, scope); return;
      case "UnaryExpression":
        // `typeof missing` is the one read that never throws; it is how code probes for an optional global.
        if (node.operator === "typeof" && node.argument.type === "Identifier") return;
        visit(node.argument, scope); return;
      case "ImportDeclaration": for (const specifier of node.specifiers) scope.names.add(specifier.local.name); return;
      case "ExportNamedDeclaration":
        if (node.declaration) visit(node.declaration, scope);
        else if (!node.source) for (const specifier of node.specifiers) visit(specifier.local, scope);
        return;
    }
    for (const key of Object.keys(node)) {
      if (SKIPPED_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) for (const child of value) visit(child, scope);
      else if (value && typeof value.type === "string") visit(value, scope);
    }
  }

  const top = new Scope(null, true);
  for (const statement of ast.body) visit(statement, top);
  // Resolved only now: a function may use a name that is declared further down (hoisting, closures called later).
  return references
    .filter(({ name, scope }) => !scope.declares(name) && !known.has(name))
    .map(({ name, line, column }) => ({ name, line, column }))
    .sort((a, b) => a.line - b.line || a.column - b.column);
}

module.exports = { findUndefinedIdentifiers, LANGUAGE_GLOBALS };
