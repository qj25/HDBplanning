(function () {
  'use strict';

  const { W, H, D, bayBounds, notchBox, partBounds, rackGeometry } = window.WardrobeModel;
  const scale = 0.181;
  const floor = 533;
  const frontLeft = (720 - W * scale) / 2;
  const escape = value => String(value).replace(/[&<>"']/g, match =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[match]);
  const token = coordinates => coordinates.map(value => Number(value.toFixed(2))).join(',');
  const rectXY = (x1, x2, y1, y2, z) => [[x1, y1, z], [x2, y1, z], [x2, y2, z], [x1, y2, z]];
  const rectXZ = (x1, x2, z1, z2, y) => [[x1, y, z1], [x2, y, z1], [x2, y, z2], [x1, y, z2]];
  const rectYZ = (y1, y2, z1, z2, x) => [[x, y1, z1], [x, y1, z2], [x, y2, z2], [x, y2, z1]];

  function project(view, [x, y, z]) {
    if (view === 'side') return [320 + z * scale, floor - y * scale];
    if (view === 'iso') {
      const dx = x - W / 2;
      const dz = z - D / 2;
      const isoScale = .144;
      return [360 + (dx + dz) * Math.sqrt(3) / 2 * isoScale,
        310 + ((dx - dz) / 2 - (y - H / 2)) * isoScale];
    }
    return [frontLeft + x * scale, floor - y * scale];
  }

  function line([x1, y1], [x2, y2], cls) {
    return '<line class="' + cls + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
  }

  function label(x, y, value, cls = 'dimension-label', extra = '') {
    return '<text class="' + cls + '" x="' + x + '" y="' + y + '" ' + extra + '>' + escape(value) + '</text>';
  }

  function dimension(a, b, offset, caption, limit = 22) {
    const horizontal = a[1] === b[1];
    const move = ([x, y]) => horizontal ? [x, y + offset] : [x + offset, y];
    const start = move(a);
    const end = move(b);
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const tick = ([x, y]) => line([x - 3, y + 3], [x + 3, y - 3], 'dimension');
    const center = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const title = horizontal ?
      label(center[0], center[1] + (offset < 0 ? -10 : 10), caption) :
      label(center[0] - 10, center[1], caption, 'dimension-label',
        'transform="rotate(-90 ' + (center[0] - 10) + ' ' + center[1] + ')"');
    return line(a, start, 'dimension') + line(b, end, 'dimension') + line(start, end, 'dimension') +
      tick(start) + tick(end) + (length >= limit ? title : '');
  }

  function axes(view) {
    const x = 122;
    const y = 563;
    const base = [x, y];
    function axis(dx, dy, name) {
      const end = [x + dx, y + dy];
      const length = Math.hypot(dx, dy);
      const [ux, uy] = [dx / length, dy / length];
      const arrow = side => [end[0] - 5 * ux - side * uy, end[1] - 5 * uy + side * ux];
      return line(base, end, 'axis') + line(end, arrow(3), 'axis') + line(end, arrow(-3), 'axis') +
        label(end[0] + 11 * ux, end[1] + 11 * uy, name, 'axis-label');
    }
    return axis(0, -35, '+Y') +
      (view === 'front' ? axis(36, 0, '+X') + label(x + 7, y + 14, '⊗ +Z', 'axis-label') :
        view === 'side' ? axis(36, 0, '+Z') + label(x + 7, y + 14, '+X ⟂', 'axis-label') :
          axis(31.2, 18, '+X') + axis(31.2, -18, '+Z'));
  }

  function frontOutline(notch) {
    if (!notch.enabled) return rectXY(0, W, 0, H, 0);
    const [x1, x2, y1, y2] = notchBox(notch);
    if (notch.side === 'left') {
      return [[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0], [0, y2, 0],
        [x2, y2, 0], [x2, y1, 0], [0, y1, 0]];
    }
    return [[0, 0, 0], [W, 0, 0], [W, y1, 0], [x1, y1, 0], [x1, y2, 0],
      [W, y2, 0], [W, H, 0], [0, H, 0]];
  }

  function sideOutline(notch, side) {
    const x = side === 'left' ? 0 : W;
    if (!notch.enabled || notch.side !== side) return [rectYZ(0, H, 0, D, x)];
    const [, , y1, y2, , depth] = notchBox(notch);
    if (depth === D) return [rectYZ(0, y1, 0, D, x), rectYZ(y2, H, 0, D, x)];
    return [[[x, 0, 0], [x, 0, D], [x, H, D], [x, H, 0], [x, y2, 0],
      [x, y2, depth], [x, y1, depth], [x, y1, 0]]];
  }

  function render(layout, options) {
    const { view, side, selected, travel, interactive = true } = options;
    const p = point => project(view, point);
    const shape = (points, cls, closed = true) => {
      const tag = closed ? 'polygon' : 'polyline';
      return '<' + tag + ' class="' + cls + '" points="' + points.map(point => token(p(point))).join(' ') + '"/>';
    };
    const edge = (a, b, cls) => line(p(a), p(b), cls);
    function group(id, drag, content, hit = '') {
      const interactions = interactive ? ' data-select="' + escape(id) + '"' +
        (view === 'front' && drag ? ' data-drag="' + drag + '"' : '') : '';
      return '<g class="' + (selected === id ? 'selected' : '') + '"' + interactions + '>' +
        content + (interactive ? hit : '') + '</g>';
    }

    const notch = layout.notch;
    const [nx1, nx2, ny1, ny2, , depth] = notchBox(notch);
    const recessEdge = notch.side === 'left' ? nx2 : nx1;
    const outerEdge = notch.side === 'left' ? nx1 : nx2;
    const cutAtBack = notch.enabled && depth === D;
    let shell = '';
    if (view === 'front' || view === 'iso') shell += shape(frontOutline(notch), 'shell');
    if (view === 'side') shell += sideOutline(notch, side).map(face => shape(face, 'shell')).join('');
    if (view === 'iso') {
      const back = frontOutline({ ...notch, enabled: cutAtBack }).map(([x, y]) => [x, y, D]);
      shell = shape(back, 'hidden-edge') +
        sideOutline(notch, 'left').map(face => shape(face, 'hidden-edge')).join('') +
        sideOutline(notch, 'right').map(face => shape(face, 'shell')).join('') + shell;
    }

    let bayHighlight = '';
    let bayLabels = '';
    let dimensions = '';
    if (view === 'front') {
      const selectedBay = layout.bays.findIndex((_, i) => selected === 'bay-' + i);
      if (selectedBay >= 0) {
        const [left, right] = bayBounds(layout, selectedBay);
        if (notch.enabled && (left === 0 && notch.side === 'left' || right === W && notch.side === 'right')) {
          const inner = left === 0 ? nx2 : nx1;
          bayHighlight = shape(rectXY(left, right, 0, ny1, 0), 'bay-fill') +
            shape(rectXY(left, right, ny2, H, 0), 'bay-fill') +
            shape(rectXY(Math.min(inner, left === 0 ? right : left), Math.max(inner, left === 0 ? right : left),
              ny1, ny2, 0), 'bay-fill');
        } else {
          bayHighlight = shape(rectXY(left, right, 0, H, 0), 'bay-fill');
        }
      }
      dimensions += dimension(p([0, H, 0]), p([W, H, 0]), -30, W + ' W');
      for (const [i, bay] of layout.bays.entries()) {
        const [left, right] = bayBounds(layout, i);
        const width = right - left;
        const [cx, cy] = p([(left + right) / 2, 95, 0]);
        dimensions += dimension(p([left, 0, 0]), p([right, 0, 0]), 25, width, 30);
        if (width > 175) {
          const text = bay.name.trim() || 'Bay ' + (i + 1);
          const max = Math.max(4, Math.floor(width * scale / 7));
          const display = text.length > max ? text.slice(0, max - 1) + '…' : text;
          bayLabels += group('bay-' + i, '', label(cx, cy, display, 'bay-label'));
        }
      }
    }
    if (view === 'side') {
      dimensions += dimension(p([0, H, 0]), p([0, H, D]), -30, D + ' D');
      dimensions += label(320, 567, 'Front', 'drawing-label') +
        label(320 + D * scale, 567, 'Back', 'drawing-label');
    }
    if (view !== 'iso') {
      dimensions += dimension(p([0, 0, 0]), p([0, H, 0]), view === 'side' ? -40 : -39, H + ' H');
    }

    let cut = '';
    if (notch.enabled) {
      if (view === 'front') {
        const outline = [ [outerEdge, ny1, 0], [recessEdge, ny1, 0],
          [recessEdge, ny2, 0], [outerEdge, ny2, 0] ];
        cut = group('notch', 'y', shape(outline, 'notch-edge', false) +
          (!cutAtBack ? shape(rectXY(nx1, nx2, ny1, ny2, depth), 'notch-face') : ''),
          shape(outline, 'hit', false));
        dimensions += dimension(p([nx1, ny1, 0]), p([nx2, ny1, 0]), 15, notch.width);
        const outer = p([outerEdge, ny1, 0]);
        const offset = notch.side === 'left' ? -15 : 25;
        dimensions += dimension(outer, p([outerEdge, ny2, 0]), offset, notch.height);
        dimensions += dimension(p([outerEdge, 0, 0]), outer, offset, notch.y);
      } else if (view === 'side') {
        const [frontBottom, backBottom, backTop, frontTop] = rectYZ(ny1, ny2, 0, depth, outerEdge);
        const outline = side !== notch.side ? shape([frontBottom, backBottom, backTop, frontTop], 'hidden-edge') :
          edge(frontBottom, backBottom, 'notch-edge') + edge(frontTop, backTop, 'notch-edge') +
          (cutAtBack ? '' : edge(backBottom, backTop, 'notch-edge'));
        cut = group('notch', '', shape([frontBottom, backBottom, backTop, frontTop], 'notch-face') + outline);
        dimensions += dimension(p([0, ny2, 0]), p([0, ny2, depth]), -16, depth, 22);
        if (side !== notch.side) {
          const [x, y] = p([0, (ny1 + ny2) / 2, depth / 2]);
          dimensions += label(x, y, 'Far side', 'drawing-label notch-label');
        }
      } else {
        const surfaces = [
          [rectXZ(nx1, nx2, 0, depth, ny1), 'notch-edge notch-surface'],
          [rectXZ(nx1, nx2, 0, depth, ny2), 'notch-edge notch-face'],
          [rectYZ(ny1, ny2, 0, depth, recessEdge), 'notch-edge notch-face'],
        ];
        if (!cutAtBack) surfaces.push([rectXY(nx1, nx2, ny1, ny2, depth), 'notch-edge notch-face']);
        cut = group('notch', '', surfaces.map(([face, cls]) => shape(face, cls)).join(''));
        const [x, y] = p([(nx1 + nx2) / 2, ny1, depth / 2]);
        dimensions += label(x, y + 14, notch.width + ' W × ' + notch.height + ' H × ' + depth + ' D',
          'drawing-label notch-label');
      }
    }

    const dividers = view === 'side' ? '' : layout.dividers.map((x, i) => {
      const face = rectYZ(0, H, 0, D, x);
      return group('main-' + i, 'x',
        view === 'front' ? edge(face[0], face[3], 'piece main-divider') : shape(face, 'piece main-divider'),
        edge(face[0], face[3], 'hit'));
    }).join('');

    function drawPart(part) {
      const [x1, x2, y1, y2, z1, z2] = partBounds(layout, part);
      if (part.type === 'rack') {
        if (view !== 'iso' && view !== 'side') {
          const face = rectXY(x1, x2, y1, y2, z1);
          const [x, y] = p([(x1 + x2) / 2, (y1 + y2) / 2, z1]);
          return group(part.id, 'y', shape(face, 'piece rack-wall') +
            label(x, y, 'Pull-out', 'drawing-label') + shape(face, 'hit'));
        }
        const a = rackGeometry(part, travel[part.id] ?? 0);
        const walls = view === 'side' ? shape(rectYZ(y1, y2, z1, z2, x1), 'piece rack-wall') :
          [rectXZ(x1, x2, z1, z2, y1), rectXZ(x1, x2, z1, z2, y2),
            rectYZ(y1, y2, z1, z2, x1), rectYZ(y1, y2, z1, z2, x2)]
            .map(face => shape(face, 'piece rack-wall')).join('');
        let hooks = '';
        for (let i = 1; i <= 5; i++) {
          const z = a.startZ + (a.endZ - a.startZ) * i / 6;
          hooks += shape([[a.x, a.y, z], [a.x, a.y - Math.min(48, part.height / 4), z],
            [a.x, a.y - Math.min(48, part.height / 4), z - Math.min(9, part.depth / 10)]], 'rack-line', false);
        }
        const mount = edge([a.x, a.y - 28, a.mountZ], [a.x, a.y + 28, a.mountZ], 'rack-line');
        const support = edge([a.x, a.y, a.endZ], [a.x, a.y, a.mountZ], 'support');
        return group(part.id, '', walls + support + mount +
          edge([a.x, a.y, a.startZ], [a.x, a.y, a.endZ], 'rack-line') + hooks, '');
      }
      if (part.type === 'rail') {
        const start = [x1, y1, z1];
        const end = [x2, y1, z1];
        if (view === 'side') {
          const [x, y] = p(start);
          return group(part.id, '', '<circle class="piece rail-line" cx="' + x + '" cy="' + y + '" r="3"/>');
        }
        return group(part.id, 'y', edge(start, end, 'piece rail-line'), edge(start, end, 'hit'));
      }
      const shelf = part.type === 'shelf';
      const face = shelf ? rectXZ(x1, x2, z1, z2, y1) : rectYZ(y1, y2, z1, z2, x1);
      const [start, end] = [face[0], face[shelf ? 1 : 3]];
      const drawing = view === 'front' ? edge(start, end, 'piece') : shape(face, 'piece shelf-plane');
      return group(part.id, shelf ? 'y' : 'x', drawing, edge(start, end, 'hit'));
    }

    const parts = layout.parts.map(drawPart).join('');
    return bayHighlight + shell + cut + dividers + parts + bayLabels + dimensions + axes(view);
  }

  window.WardrobeDrawing = { render, scale };
}());
