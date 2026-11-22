"use strict";
// Extracting a bounded piece of a source file for a structural test.
//
// The Notes sheet is one huge closure that needs a whole browser to build, so a test cannot import one of its
// functions and call it. It can, however, read the function's own text and check the shape of it: that a guard runs
// before the state it protects, that a step is wrapped, that a marker block is bounded. That is how OW-130 and
// OW-133 test the sheet without a browser (see tests/ow-130-pill-autohide-gesture.test.cjs).
//
// `balanced` walks braces but understands strings, template literals (including `${…}` inside them) and comments, so
// a `}` inside a string or a template does not end a function early.

function skipQuoted(src, i, quote) {
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src[j] === quote) return j + 1;
    j++;
  }
  return -1;
}

function scanCode(src, i, depth) {
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      i = skipQuoted(src, i, c);
      if (i < 0) return -1;
      continue;
    }
    if (c === "`") {
      i = skipTemplate(src, i);
      if (i < 0) return -1;
      continue;
    }
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth--;
      i++;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return -1;
}

function skipTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src[j] === "`") return j + 1;
    if (src[j] === "$" && src[j + 1] === "{") {
      j = scanCode(src, j + 2, 1);
      if (j < 0) return -1;
      continue;
    }
    j++;
  }
  return -1;
}

// The index just after the delimiter that closes the `open` at `openIndex` (any bracket pair, same skipping rules):
// used to step over a parameter list, which may itself contain a destructuring `{ … }`.
function delimited(src, openIndex, open, close) {
  if (src[openIndex] !== open) throw new Error(`delimited() needs ${JSON.stringify(open)} at ${openIndex}, got ${JSON.stringify(src[openIndex])}`);
  let depth = 1;
  let i = openIndex + 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      i = skipQuoted(src, i, c);
      if (i < 0) return -1;
      continue;
    }
    if (c === "`") {
      i = skipTemplate(src, i);
      if (i < 0) return -1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

// The index just after the `}` that closes the `{` at `openIndex`.
function balanced(src, openIndex) {
  if (src[openIndex] !== "{") throw new Error(`balanced() needs a "{", got ${JSON.stringify(src[openIndex])} at ${openIndex}`);
  const end = scanCode(src, openIndex + 1, 1);
  if (end < 0) throw new Error(`unbalanced braces from offset ${openIndex}`);
  return end;
}

// `{ start, end, text }` of `function <name>(…) { … }`, including the header.
function functionBlock(src, name) {
  const re = new RegExp(`function\\s+${name.replace(/[$]/g, "\\$")}\\s*\\(`);
  const hit = re.exec(src);
  if (!hit) throw new Error(`function ${name}() not found`);
  const parenIndex = src.indexOf("(", hit.index + hit[0].length - 1);
  const afterParams = delimited(src, parenIndex, "(", ")");
  if (afterParams < 0) throw new Error(`function ${name}() has an unclosed parameter list`);
  const openIndex = src.indexOf("{", afterParams);
  if (openIndex < 0) throw new Error(`function ${name}() has no body`);
  const end = balanced(src, openIndex);
  return { start: hit.index, end, text: src.slice(hit.index, end) };
}

// Every `function <name>(…) { … }` whose header starts inside [from, to): [{ name, start, end, text }].
function functionBlocks(src, from = 0, to = src.length) {
  const out = [];
  const re = /(?:^|[^\w$.])function\s+([\w$]+)\s*\(/g;
  re.lastIndex = from;
  let hit;
  while ((hit = re.exec(src)) && hit.index < to) {
    const parenIndex = src.indexOf("(", hit.index + hit[0].length - 1);
    const afterParams = delimited(src, parenIndex, "(", ")");
    if (afterParams < 0) break;
    const openIndex = src.indexOf("{", afterParams);
    if (openIndex < 0 || openIndex > to) break;
    const end = balanced(src, openIndex);
    out.push({ name: hit[1], start: hit.index, end, text: src.slice(hit.index, end) });
    re.lastIndex = end;
  }
  return out;
}

// `{ start, end, text }` of `const <name> = …;` — one statement, however many braces or lines it spans.
function constBlock(src, name) {
  const re = new RegExp(`(?:^|\\n)[ \\t]*const\\s+${name.replace(/[$]/g, "\\$")}\\s*=`);
  const hit = re.exec(src);
  if (!hit) throw new Error(`const ${name} = … not found`);
  const start = hit.index + (hit[0].startsWith("\n") ? 1 : 0);
  let i = hit.index + hit[0].length;
  let depth = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      i = skipQuoted(src, i, c);
      if (i < 0) throw new Error(`const ${name} = … has an unclosed string`);
      continue;
    }
    if (c === "`") {
      i = skipTemplate(src, i);
      if (i < 0) throw new Error(`const ${name} = … has an unclosed template`);
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === ";" && depth === 0) {
      i++;
      return { start, end: i, text: src.slice(start, i) };
    }
    i++;
  }
  throw new Error(`const ${name} = … has no terminating ;`);
}

// The text between two `// <<MARK>>` markers (markers included). Fails loudly when a marker is missing, which is
// the point: a bounded block that loses its end marker cannot be tested any more.
function markedBlock(src, begin, end) {
  const start = src.indexOf(begin);
  const stop = src.indexOf(end);
  if (start < 0) throw new Error(`missing marker: ${begin}`);
  if (stop < start) throw new Error(`missing end marker: ${end}`);
  return src.slice(start, stop + end.length);
}

module.exports = { balanced, constBlock, delimited, functionBlock, functionBlocks, markedBlock, scanCode };
