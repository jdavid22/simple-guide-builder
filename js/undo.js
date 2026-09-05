/* undo.js — tiny action-scoped undo stack for REMOVALS.
 *
 * Deleting something detaches an object from the project; we simply keep a
 * reference to it (zero copies) plus a closure that splices it back. Bounded
 * to the last few removals. Classic script -> global `Undo`. */
(function (global) {
  'use strict';
  var MAX = 5;
  var stack = [];   // newest first: { label, undo: fn -> true|false }

  function push(entry) {
    stack.unshift(entry);
    if (stack.length > MAX) stack.length = MAX;
  }

  // Pops and runs the newest entry. Returns { entry, result } or null when empty.
  function pop() {
    var e = stack.shift();
    if (!e) return null;
    var r;
    try { r = e.undo(); } catch (err) { r = false; }
    return { entry: e, result: r };
  }

  function clear() { stack.length = 0; }
  function size() { return stack.length; }

  global.Undo = { push: push, pop: pop, clear: clear, size: size, MAX: MAX };
})(typeof window !== 'undefined' ? window : this);
