(function () {
  'use strict';

  const M = window.WardrobeModel;
  const Outline = window.WardrobeOutline;
  const { bayBounds, notchBox, partBounds, rackGeometry } = M;
  const callouts = { 'front-width': -30, 'front-height': -39, 'side-depth': -30, 'side-height': -40 };
  const escape = value => String(value).replace(/[&<>"']/g, match =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[match]);
  const token = coordinates => coordinates.map(value => Number(value.toFixed(2))).join(',');
  const rectXY = (x1, x2, y1, y2, z) => [[x1, y1, z], [x2, y1, z], [x2, y2, z], [x1, y2, z]];
  const rectXZ = (x1, x2, z1, z2, y) => [[x1, y, z1], [x2, y, z1], [x2, y, z2], [x1, y, z2]];
  const rectYZ = (y1, y2, z1, z2, x) => [[x, y1, z1], [x, y1, z2], [x, y2, z2], [x, y2, z1]];

  function frame(layout, options, geometry = M.hasCustomOutline(layout) ? M.outlineGeometry(layout) : null) {
    const { view, travel = {} } = options;
    const { width, height, depth } = M.sizeOf(layout);
    const [left, right, bottom, top] = geometry?.bounds ?? [0, width, 0, height];
    const front = Math.min(0, ...layout.parts.filter(part => part.type === 'rack')
      .map(part => rackGeometry(part, travel[part.id] ?? 0, depth).startZ));
    let scale = Math.min(470 / (top - bottom), 435 / (right - left));
    if (view === 'side') scale = Math.min(470 / (top - bottom), 435 / (depth - front));
    if (view === 'iso') scale = Math.min(435 / ((right - left + depth - front) * Math.sqrt(3) / 2),
      470 / (top - bottom + (right - left + depth - front) / 2));
    const xMid = (left + right) / 2, yMid = (bottom + top) / 2, zMid = (front + depth) / 2;
    const project = ([x, y, z]) => {
      if (view === 'side') return [360 + (z - zMid) * scale, 300 - (y - yMid) * scale];
      if (view === 'iso') return [360 + (x - xMid + z - zMid) * Math.sqrt(3) / 2 * scale,
        300 + ((x - xMid - z + zMid) / 2 - (y - yMid)) * scale];
      return [360 + (x - xMid) * scale, 300 - (y - yMid) * scale];
    };
    return { project, scale, left, right, bottom, top };
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

  function frontOutline(notch, W, H) {
    if (!notch.enabled) return rectXY(0, W, 0, H, 0);
    const [x1, x2, y1, y2] = notchBox(notch, W);
    if (notch.side === 'left') {
      return [[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0], [0, y2, 0],
        [x2, y2, 0], [x2, y1, 0], [0, y1, 0]];
    }
    return [[0, 0, 0], [W, 0, 0], [W, y1, 0], [x1, y1, 0], [x1, y2, 0],
      [W, y2, 0], [W, H, 0], [0, H, 0]];
  }

  function sideOutline(notch, side, W, H, D) {
    const x = side === 'left' ? 0 : W;
    if (!notch.enabled || notch.side !== side) return [rectYZ(0, H, 0, D, x)];
    const [, , y1, y2, , depth] = notchBox(notch);
    if (depth === D) return [rectYZ(0, y1, 0, D, x), rectYZ(y2, H, 0, D, x)];
    return [[[x, 0, 0], [x, 0, D], [x, H, D], [x, H, 0], [x, y2, 0],
      [x, y2, depth], [x, y1, depth], [x, y1, 0]]];
  }

  function frontPath(section, p, scale) {
    const first = section.corners[0];
    const point = ([x, y]) => token(p([x, y, section.z1]));
    return 'M ' + point(first.incoming) + section.corners.map((corner, i) => {
      const radius = corner.radius * scale;
      const move = i ? ' L ' + point(corner.incoming) : '';
      return move + (radius ? ' A ' + radius + ' ' + radius + ' 0 0 ' + (corner.sweep > 0 ? 0 : 1) +
        ' ' + point(corner.outgoing) : '');
    }).join('') + ' Z';
  }

  function render(layout, options) {
    const { view, side, selected, travel = {}, interactive = true, full = false, guide } = options;
    const { width: W, height: H, depth: D } = M.sizeOf(layout);
    const geometry = M.hasCustomOutline(layout) ? M.outlineGeometry(layout) : null;
    const projection = options.projection ?? frame(layout, options, geometry);
    const { project: p, scale } = projection;
    const [leftEdge, rightEdge, bottomEdge, topEdge] = geometry?.bounds ?? [0, W, 0, H];
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
    const [nx1, nx2, ny1, ny2, , depth] = notchBox(notch, W);
    const recessEdge = notch.side === 'left' ? nx2 : nx1;
    const outerEdge = notch.side === 'left' ? nx1 : nx2;
    const cutAtBack = notch.enabled && depth === D;
    let shell = '';
    if (geometry) {
      if (view === 'front') {
        shell = [...geometry.sections].reverse().map((section, i) =>
          '<path class="' + (i === geometry.sections.length - 1 ? 'shell' : 'shell depth-edge') +
          '" d="' + frontPath(section, p, scale) + '"/>').join('');
      } else {
        for (const section of geometry.sections) {
          const points = section.samples;
          if (view === 'iso') {
            for (const z of [section.z2, section.z1]) {
              shell += shape(points.map(([x, y]) => [x, y, z]), z ? 'hidden-edge' : 'shell');
            }
          } else {
            const ys = points.map(point => point[1]);
            shell += shape(rectYZ(Math.min(...ys), Math.max(...ys), section.z1, section.z2, 0), 'shell');
          }
          for (const [i, a] of points.entries()) {
            const b = points[(i + 1) % points.length];
            if (view === 'side' && a[1] !== b[1]) continue;
            if (view === 'iso' && i && section.corners.some(c => c.radius &&
              Math.abs(Math.hypot(a[0] - c.center[0], a[1] - c.center[1]) - c.radius) < 1e-7 &&
              a !== c.incoming && a !== c.outgoing)) continue;
            const visible = view === 'iso' ? b[1] > a[1] || b[0] < a[0] :
              side === 'left' ? a[0] <= W / 2 : a[0] >= W / 2;
            shell += edge([...a, section.z1], [...a, section.z2], visible ? 'profile-edge' : 'hidden-edge');
          }
        }
      }
    } else if (view === 'front') shell += shape(frontOutline(notch, W, H), 'shell');
    else if (view === 'side') shell += sideOutline(notch, side, W, H, D).map(face => shape(face, 'shell')).join('');
    else {
      const back = frontOutline({ ...notch, enabled: cutAtBack }, W, H).map(([x, y]) => [x, y, D]);
      shell = shape(back, 'hidden-edge') +
        sideOutline(notch, 'left', W, H, D).map(face => shape(face, 'hidden-edge')).join('') +
        sideOutline(notch, 'right', W, H, D).map(face => shape(face, 'shell')).join('') +
        shape(frontOutline(notch, W, H), 'shell');
    }

    let bayHighlight = '';
    let bayLabels = '';
    let dimensions = '';
    function overall(id, a, b, value) {
      const offset = layout.callouts?.[id] ?? callouts[id];
      const a2 = p(a), b2 = p(b);
      const horizontal = a2[1] === b2[1];
      const shift = ([x, y]) => horizontal ? [x, y + offset] : [x + offset, y];
      const content = dimension(a2, b2, offset, value, 0);
      if (!interactive) return content;
      return '<g data-select="dim-' + id + '" data-drag="' + (horizontal ? 'callout-y' : 'callout-x') + '">' +
        content + line(shift(a2), shift(b2), 'hit') + '</g>';
    }
    if (view === 'front') {
      const selectedBay = layout.bays.findIndex((_, i) => selected === 'bay-' + i);
      if (selectedBay >= 0 && geometry) {
        const [left, right] = bayBounds(layout, selectedBay);
        const a = selectedBay === 0 ? leftEdge : left;
        const b = selectedBay === layout.bays.length - 1 ? rightEdge : right;
        bayHighlight = '<defs><clipPath id="active-bay-clip">' + geometry.sections.map(section =>
          '<path d="' + frontPath(section, p, scale) + '"/>').join('') + '</clipPath></defs>' +
          '<g clip-path="url(#active-bay-clip)">' + shape(rectXY(a, b, bottomEdge, topEdge, 0), 'bay-fill') + '</g>';
      } else if (selectedBay >= 0) {
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
      dimensions += overall('front-width', [leftEdge, topEdge, 0], [rightEdge, topEdge, 0],
        Math.round(rightEdge - leftEdge) + ' W');
      for (const [i, bay] of layout.bays.entries()) {
        const [left, right] = bayBounds(layout, i);
        const width = right - left;
        const [cx, cy] = p([(left + right) / 2, 95, 0]);
        dimensions += dimension(p([left, bottomEdge, 0]), p([right, bottomEdge, 0]), 25, width, 30);
        if (width > 175) {
          const text = bay.name.trim() || 'Bay ' + (i + 1);
          const max = Math.max(4, Math.floor(width * scale / 7));
          const display = text.length > max ? text.slice(0, max - 1) + '…' : text;
          bayLabels += group('bay-' + i, '', label(cx, cy, display, 'bay-label'));
        }
      }
    }
    if (view === 'side') {
      dimensions += overall('side-depth', [0, topEdge, 0], [0, topEdge, D], D + ' D');
      dimensions += label(p([0, 0, 0])[0], 567, 'Front', 'drawing-label') +
        label(p([0, 0, D])[0], 567, 'Back', 'drawing-label');
    }
    if (view !== 'iso') {
      dimensions += overall(view + '-height', [leftEdge, bottomEdge, 0], [leftEdge, topEdge, 0],
        Math.round(topEdge - bottomEdge) + ' H');
    }

    let cut = '';
    if (notch.enabled && !geometry) {
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
      if (geometry) {
        let content = '', hits = '';
        for (const section of geometry.sections) {
          for (const [low, high] of Outline.intervals(section, x, true)) {
            if (high - low < 1e-7) continue;
            const face = rectYZ(low, high, section.z1, section.z2, x);
            content += view === 'front' ? edge(face[0], face[3], 'piece main-divider') : shape(face, 'piece main-divider');
            hits += edge(face[0], face[3], 'hit');
          }
        }
        return group('main-' + i, 'x', content, hits);
      }
      const face = rectYZ(0, H, 0, D, x);
      return group('main-' + i, 'x',
        view === 'front' ? edge(face[0], face[3], 'piece main-divider') : shape(face, 'piece main-divider'),
        edge(face[0], face[3], 'hit'));
    }).join('');

    function drawPart(part) {
      const [x1, x2, y1, y2, z1, z2] = partBounds(layout, part, geometry);
      if (part.type === 'rack') {
        if (view !== 'iso' && view !== 'side') {
          const face = rectXY(x1, x2, y1, y2, z1);
          const [x, y] = p([(x1 + x2) / 2, (y1 + y2) / 2, z1]);
          return group(part.id, 'xy', shape(face, 'piece rack-wall') +
            label(x, y, 'Pull-out', 'drawing-label') + shape(face, 'hit'));
        }
        const a = rackGeometry(part, travel[part.id] ?? 0, D);
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
      return group(part.id, shelf ? 'y' : 'xy', drawing, edge(start, end, 'hit'));
    }

    const parts = layout.parts.map(drawPart).join('');
    let controls = '';
    if (interactive && view === 'front') {
      const part = layout.parts.find(item => item.id === selected);
      if (part && ['divider', 'rack'].includes(part.type)) {
        const [x1, x2, y1, y2] = partBounds(layout, part, geometry);
        const [x, y] = p([(x1 + x2) / 2, (y1 + y2) / 2, 0]);
        controls += [['x', [x + 42, y], 'X'], ['y', [x, y - 42], 'Y']].map(([axis, end, name]) =>
          '<g class="move-handle" data-select="' + part.id + '" data-drag="' + axis + '">' +
          line([x, y], end, 'move-axis move-' + axis) +
          line(axis === 'x' ? [x + 15, y] : [x, y - 15], end, 'hit') +
          '<circle cx="' + end[0] + '" cy="' + end[1] + '" r="10"/>' +
          label(end[0], end[1] + 4, name, 'move-label') + '</g>').join('');
      }
      if (selected?.startsWith('outline-')) {
        const feature = layout.features?.find(item => 'outline-' + item.id === selected);
        if (feature) {
          const [x1, x2, y1, y2] = Outline.featureBox(feature);
          controls += shape(rectXY(x1, x2, y1, y2, 0), 'outline-preview');
          const vertical = ['left', 'right'].includes(feature.edge);
          const [x, y] = p(vertical ? [feature.at === x1 ? x2 : x1, (y1 + y2) / 2, 0] :
            [(x1 + x2) / 2, feature.at === y1 ? y2 : y1, 0]);
          controls += '<circle class="outline-handle" data-select="' + selected + '" data-drag="feature-offset" cx="' +
            x + '" cy="' + y + '" r="8"/>';
          const spanPoints = vertical ? [[feature.at, y1, 0], [feature.at, y2, 0]] :
            [[x1, feature.at, 0], [x2, feature.at, 0]];
          for (const [i, point] of spanPoints.entries()) {
            const [cx, cy] = p(point);
            controls += '<circle class="outline-handle" data-select="' + selected + '" data-drag="feature-' +
              (i ? 'end' : 'start') + '" cx="' + cx + '" cy="' + cy + '" r="7"/>';
          }
        }
      }
      if (guide?.axis === 'x') controls += edge([guide.value, bottomEdge, 0], [guide.value, topEdge, 0], 'snap-guide');
      if (guide?.axis === 'y') controls += edge([leftEdge, guide.value, 0], [rightEdge, guide.value, 0], 'snap-guide');
    }
    const markerPositions = [];
    const markers = full && view !== 'iso' ? measurementRecords(layout, view, geometry).map((record, i) => {
      const [x, y] = p(record.anchor);
      const offsets = [[14, -14], [-14, -14], [14, 14], [-14, 14], [31, 0], [-31, 0], [0, -31], [0, 31]];
      let position;
      for (let ring = 1; ring <= 6 && !position; ring++) {
        position = offsets.map(([dx, dy]) => [x + dx * ring, y + dy * ring]).find(([a, b]) =>
          a > 18 && a < 702 && b > 18 && b < 598 &&
          markerPositions.every(([u, v]) => Math.hypot(a - u, b - v) > 20));
      }
      const [cx, cy] = position ?? [x, y];
      markerPositions.push([cx, cy]);
      return line([x, y], [cx, cy], 'measure-leader') + '<circle class="measure-dot" cx="' + cx + '" cy="' + cy +
        '" r="8"/>' + label(cx, cy + 3, i + 1, 'measure-number');
    }).join('') : '';
    return bayHighlight + shell + cut + dividers + parts + bayLabels + dimensions + markers + controls + axes(view);
  }

  function measurementRecords(layout, view, geometry = M.hasCustomOutline(layout) ? M.outlineGeometry(layout) : null) {
    if (view === 'iso') return [];
    const front = view === 'front';
    const span = (a, b) => a === b ? String(a) : a + '–' + b + ' (' + (b - a) + ')';
    const records = [];
    if (front) {
      for (const [i, bay] of layout.bays.entries()) {
        const [a, b] = bayBounds(layout, i);
        records.push({ title: 'Bay ' + (i + 1) + (bay.name ? ' · ' + bay.name : ''),
          value: 'Nominal X ' + span(a, b), anchor: [(a + b) / 2, 0, 0] });
      }
    }
    for (const feature of M.shapeEdits(layout)) {
      const [a, b, c, d] = Outline.featureBox(feature);
      records.push({ title: feature.id === 'notch' ? 'Side notch' : feature.kind === 'cut' ? 'Cut in' : 'Extension',
        value: front ? 'X ' + span(a, b) + ' · Y ' + span(c, d) +
          ' · ' + feature.offset + ' offset' : 'Y ' + span(c, d) + ' · Z ' + span(feature.z1, feature.z2),
        anchor: [(a + b) / 2, (c + d) / 2, (feature.z1 + feature.z2) / 2] });
      if (front && geometry) {
        const y = Math.round((c + d) / 2);
        const [clear] = geometry.slices(y, feature.z1, feature.z2);
        if (clear) records[records.length - 1].value += ' · clear profile X ' + span(...clear.map(Math.round));
      }
    }
    for (const radius of layout.radii ?? []) {
      if (radius.radius && front) records.push({ title: 'Corner radius',
        value: 'R' + radius.radius + ' · X ' + radius.x + ' · Y ' + radius.y + ' · at Z ' + radius.z,
        anchor: [radius.x, radius.y, radius.z] });
    }
    for (const part of layout.parts) {
      const [a, b, c, d, e, f] = partBounds(layout, part, geometry);
      records.push({ title: M.TYPES[part.type] + ' · Bay ' + (part.bay + 1),
        value: front ? 'X ' + span(a, b) + ' · Y ' + span(c, d) :
          'Y ' + span(c, d) + ' · Z ' + span(e, f) + (part.type === 'rack' ? ' · travel ' + part.travel : ''),
        anchor: [(a + b) / 2, (c + d) / 2, (e + f) / 2] });
    }
    return records;
  }

  window.WardrobeDrawing = { render, frame, measurementRecords, callouts };
}());
