(function () {
  'use strict';

  function movePart(part, dx, dy) {
    const moved = { ...part };
    if (['rack', 'drawer', 'divider'].includes(part.type)) moved.x += dx;
    if (part.type === 'divider') {
      moved.y1 += dy;
      moved.y2 += dy;
    } else {
      moved.y += dy;
    }
    return moved;
  }

  function nearestSnap(candidates, axis, tolerance, accepts) {
    return candidates
      .filter(item => (axis === 'xy' || axis === item.axis) && Math.abs(item.delta) <= tolerance)
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.id.localeCompare(b.id))
      .find(accepts);
  }

  const movement = { movePart, nearestSnap };
  if (typeof module === 'object') module.exports = movement;
  else window.WardrobeMovement = movement;
}());
