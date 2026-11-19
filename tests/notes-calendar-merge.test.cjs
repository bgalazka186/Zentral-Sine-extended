"use strict";
const assert = require("node:assert/strict"), { performance } = require("node:perf_hooks");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const now = 1700000000000;
const item = (id, updated = now, summary = id) => C.makeItem({ id, summary, updated: new Date(updated).toISOString(), rev: 1, start: { dateTime: new Date(now + 86400000).toISOString() }, x: { kind: "event", src: "manual" } }, now);
const snap = (items, categories = []) => ({ items, categories });
assert.equal(typeof C.mergeCalendarSnapshots, "function", "calendar needs a three-way merge before stale windows can write safely");
{
  const base = snap([item("a"), item("b"), item("remove")], [C.cleanCategory({ name: "Old", color: "#112233" })]);
  const local = snap([{ ...base.items[0], summary: "local", updated: new Date(now + 1000).toISOString() }, base.items[1], item("new-local", now + 1000)], base.categories);
  const remote = snap([base.items[0], { ...base.items[1], summary: "remote", updated: new Date(now + 2000).toISOString() }, base.items[2], item("new-remote", now + 2000)], [...base.categories, C.cleanCategory({ name: "Added" })]);
  const before = JSON.stringify([base, local, remote]), result = C.mergeCalendarSnapshots(base, local, remote);
  assert.deepEqual(result.conflicts, []); assert.equal(JSON.stringify([base, local, remote]), before, "inputs remain unchanged");
  assert.deepEqual(result.items.map(i => i.id).sort(), ["a", "b", "new-local", "new-remote"]);
  assert.equal(result.items.find(i => i.id === "a").summary, "local");
  assert.equal(result.items.find(i => i.id === "b").summary, "remote");
  assert.deepEqual(result.categories.map(c => c.name).sort(), ["Added", "Old"]);
}
{
  const original = item("same"), local = { ...original, summary: "local", updated: new Date(now + 2000).toISOString() }, remote = { ...original, summary: "remote", updated: new Date(now + 1000).toISOString() };
  const result = C.mergeCalendarSnapshots(snap([original]), snap([local]), snap([remote]));
  assert.equal(result.items[0].summary, "local");
  assert.deepEqual(result.conflicts.map(c => [c.kind, c.id, c.winner]), [["item", "same", "local"]]);
  const tieLocal = { ...local, rev: 2 }, tieRemote = { ...local, summary: "tie remote", rev: 2 };
  const tie = C.mergeCalendarSnapshots(snap([original]), snap([tieLocal]), snap([tieRemote]));
  assert.equal(tie.items[0].summary, "tie remote"); assert.equal(tie.conflicts[0].winner, "remote");
}
{
  const original = item("same"), changed = { ...original, summary: "changed", updated: new Date(now + 2000).toISOString() };
  for (const [local, remote] of [[[], [changed]], [[changed], []]]) {
    const result = C.mergeCalendarSnapshots(snap([original]), snap(local), snap(remote));
    assert.equal(result.conflicts[0].winner, "unresolved", "a delete/edit race cannot be ordered without a deletion timestamp");
    assert.equal(result.safe, false, "callers must not write an unresolved merge");
    assert.equal(result.items[0].summary, "changed", "the surviving version remains available for inspection");
  }
  const category = C.cleanCategory({ name: "Projects", color: "#111111" });
  const result = C.mergeCalendarSnapshots(snap([], [category]), snap([], [{ ...category, color: "#222222" }]), snap([], [{ ...category, color: "#333333" }]));
  assert.deepEqual(result.conflicts.map(c => [c.kind, c.id, c.winner]), [["category", "projects", "unresolved"]]); assert.equal(result.safe, false);
  const removed = C.mergeCalendarSnapshots(snap([], [category]), snap([], [category]), snap([], []));
  assert.deepEqual(removed.categories, []); assert.equal(removed.safe, true, "an uncontested removal stays removed");
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  reordered.x = Object.fromEntries(Object.entries(original.x).reverse());
  const orderOnly = C.mergeCalendarSnapshots(snap([original]), snap([]), snap([reordered]));
  assert.equal(orderOnly.safe, true, "property order alone does not turn a clean deletion into a conflict");
  assert.deepEqual(orderOnly.items, []);
  assert.throws(() => C.mergeCalendarSnapshots(snap([original, original]), snap([]), snap([])), /duplicate/i, "ambiguous snapshots are rejected");
}
for (const count of [500, 2000]) {
  const base = snap(Array.from({ length: count }, (_, i) => item("id-" + i)));
  const local = snap(base.items.map((v, i) => i % 2 ? v : { ...v, summary: "local-" + i }));
  const remote = snap(base.items.map((v, i) => i % 2 ? { ...v, summary: "remote-" + i } : v));
  const start = performance.now(), merged = C.mergeCalendarSnapshots(base, local, remote), elapsed = performance.now() - start;
  assert.equal(merged.items.length, count); assert.equal(merged.conflicts.length, 0);
  assert.ok(elapsed < 2000, `merge ${count} took ${elapsed}ms`); console.log(`calendar merge ${count}: ${elapsed.toFixed(1)}ms`);
}
console.log("Calendar three-way merge tests passed");
