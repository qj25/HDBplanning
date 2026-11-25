(function () {
  'use strict';

  function createHistory(limit = 80) {
    const past = [];
    const future = [];
    return {
      get canUndo() { return past.length > 0; },
      get canRedo() { return future.length > 0; },
      record(before, after) {
        if (JSON.stringify(before) === JSON.stringify(after)) return false;
        past.push(before);
        if (past.length > limit) past.shift();
        future.length = 0;
        return true;
      },
      undo(current) {
        if (!past.length) return current;
        future.push(current);
        return past.pop();
      },
      redo(current) {
        if (!future.length) return current;
        past.push(current);
        return future.pop();
      },
    };
  }

  if (typeof module === 'object') module.exports = { createHistory };
  else window.WardrobeHistory = { createHistory };
}());
