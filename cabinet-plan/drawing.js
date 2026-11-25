(function () {
  'use strict';

  const M = window.WardrobeModel;
  const Outline = window.WardrobeOutline;
  const { bayBounds, notchBox, partBounds, rackGeometry } = M;
  const SIDE_WIDTH = 360;
  const callouts = { 'front-width': -30, 'front-height': -39, 'side-depth': -30, 'side-height': -40 };
  const escape = value => String(value).replace(/[&<>"']/g, match =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[match]);
  const token = coordinates => coordinates.map(value => Number(value.toFixed(2))).join(',');
  const rectXY = (x1, x2, y1, y2, z) => [[x1, y1, z], [x2, y1, z], [x2, y2, z], [x1, y2, z]];
  const rectXZ = (x1, x2, z1, z2, y) => [[x1, y, z1], [x2, y, z1], [x2, y, z2], [x1, y, z2]];
  const rectYZ = (y1, y2, z1, z2, x) => [[x, y1, z1], [x, y1, z2], [x, y2, z2], [x, y2, z1]];

  function frame(layout, options, geometry = M.hasCustomOutline(layout) ? M.outlineGeometry(layout) : null) {
    const { view, side, travel = {}, full = false } = options;
    const { width, height, depth } = M.sizeOf(layout);
    const [left, right, bottom, top] = geometry?.bounds ?? [0, width, 0, height];
    const front = Math.min(0, ...layout.parts.map(part => {
      const fraction = full && view !== 'front' ? 1 : travel[part.id] ?? 0;
      if (part.type === 'rack') return rackGeometry(part, fraction, depth).startZ;
      if (part.type === 'drawer') return part.z - part.travel * fraction;
      return 0;
    }));
    let scale = Math.min(430 / (top - bottom), 435 / (right - left));
    if (view === 'side') scale = Math.min(430 / (top - bottom), 160 / (depth - front));
    if (view === 'iso') scale = Math.min(435 / ((right - left + depth - front) * Math.sqrt(3) / 2),
      430 / (top - bottom + (right - left + depth - front) / 2));
    const xMid = (left + right) / 2, yMid = (bottom + top) / 2, zMid = (front + depth) / 2;
    const depthDirection = side === 'right' ? -1 : 1;
    const project = ([x, y, z]) => {
      if (view === 'side') return [SIDE_WIDTH / 2 + depthDirection * (z - zMid) * scale, 300 - (y - yMid) * scale];
      if (view === 'iso') return [360 + (x - xMid + z - zMid) * Math.sqrt(3) / 2 * scale,
        300 + ((x - xMid - z + zMid) / 2 - (y - yMid)) * scale];
      return [360 + (x - xMid) * scale, 300 - (y - yMid) * scale];
    };
    return { project, scale, left, right, bottom, top, depthDirection };
  }

  function line([x1, y1], [x2, y2], cls) {
    return '<line class="' + cls + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
  }

  function label(x, y, value, cls = 'dimension-label') {
    return '<text class="' + cls + '" x="' + x + '" y="' + y + '">' + escape(value) + '</text>';
  }

  function dimensionGeometry(a, b, offset) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const normal = !dx ? [1, 0] : [-dy / length * Math.sign(dx), Math.abs(dx) / length];
    const start = a.map((value, i) => value + offset * normal[i]);
    const end = b.map((value, i) => value + offset * normal[i]);
    return { start, end, length, normal, center: start.map((value, i) => (value + end[i]) / 2) };
  }

  function dimension(a, b, offset, caption, textPosition) {
    const { start, end, length, normal, center } = dimensionGeometry(a, b, offset);
    if (!length) return '';
    const tick = ([x, y]) => line([x - 2.5, y + 2.5], [x + 2.5, y - 2.5], 'dimension');
    const [x, y] = textPosition ?? center.map((value, i) => value + normal[i] * (offset < 0 ? -8 : 8));
    const leader = textPosition ? line(center, [x, y], 'dimension extension') : '';
    return line(a, start, 'dimension extension') + line(b, end, 'dimension extension') +
      line(start, end, 'dimension') + tick(start) + tick(end) + leader +
      label(x, y, caption);
  }

  function clipAtX(points, x, sign) {
    return points.flatMap((a, index) => {
      const b = points[(index + 1) % points.length];
      const inside = (a[0] - x) * sign >= 0;
      const crosses = inside !== ((b[0] - x) * sign >= 0);
      return [...(inside ? [a] : []),
        ...(crosses ? [[x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])]] : [])];
    });
  }

  function sideProfile(layout, profile, bay, side) {
    const [nominalLeft, nominalRight] = bayBounds(layout, bay);
    const left = bay ? nominalLeft : profile.bounds[0];
    const right = bay === layout.dividers.length ? profile.bounds[1] : nominalRight;
    return profile.sections.map(section => {
      const clipped = clipAtX(clipAtX(section.samples, left, 1), right, -1);
      const levels = [...new Set(clipped.map(point => point[1]))].sort((a, b) => a - b);
      const spans = [];
      for (const [index, bottom] of levels.slice(0, -1).entries()) {
        const top = levels[index + 1];
        const crossesBay = Outline.intervals(section, (bottom + top) / 2)
          .some(([a, b]) => a < right && b > left);
        if (!crossesBay) continue;
        if (spans.at(-1)?.[1] === bottom) spans.at(-1)[1] = top;
        else spans.push([bottom, top]);
      }
      const edges = section.segments.filter(([a, b]) =>
        a[1] === b[1] && Math.min(a[0], b[0]) < right && Math.max(a[0], b[0]) > left)
        .map(([a, b]) => {
          const middle = (Math.max(left, Math.min(a[0], b[0])) + Math.min(right, Math.max(a[0], b[0]))) / 2;
          const offsets = Outline.intervals(section, a[1] + (a[0] < b[0] ? -0.01 : 0.01));
          const hidden = offsets.some(([low, high]) => side === 'right' ?
            high > middle + 0.01 && low < right : low < middle - 0.01 && high > left);
          return { y: a[1], hidden, lower: a[0] < b[0] };
        });
      return { section, spans, edges };
    });
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
    if (options.view !== 'side') return renderView(layout, options);
    const bays = options.sideBays ?? layout.bays.map((_, index) => index);
    const profile = M.outlineGeometry(layout);
    const projection = options.projection ?? frame(layout, options,
      M.hasCustomOutline(layout) ? profile : null);
    return bays.map((bay, index) => bay === null ? '' : '<g class="side-bay" data-side-bay="' + bay + '" transform="translate(' +
      SIDE_WIDTH * index + ' 0)">' + renderView(layout, { ...options, bay, projection, profile }) + '</g>').join('');
  }

  function renderView(layout, options) {
    const { view, side, bay, selected, travel = {}, interactive = true, full = false, guide } = options;
    const { width: W, height: H, depth: D } = M.sizeOf(layout);
    const { edge: edgeThickness, internal } = M.thicknessOf(layout);
    const custom = M.hasCustomOutline(layout);
    const geometry = custom ? options.profile ?? M.outlineGeometry(layout) : null;
    const profile = options.profile ?? geometry ?? (edgeThickness ? M.outlineGeometry(layout) : null);
    const partGeometry = custom || edgeThickness ? profile : undefined;
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
    if (view === 'side') {
      for (const { section, spans, edges } of sideProfile(layout, profile, bay, side)) {
        for (const [bottom, top] of spans) {
          shell += shape(rectYZ(bottom, top, section.z1, section.z2, 0), 'shell');
        }
        for (const { y, hidden, lower } of edges) {
          shell += edge([0, y, section.z1], [0, y, section.z2], hidden ? 'hidden-edge' : 'profile-edge');
          if (edgeThickness) {
            const inside = y + (lower ? edgeThickness : -edgeThickness);
            shell += edge([0, inside, section.z1], [0, inside, section.z2], 'board-edge');
          }
        }
      }
    } else if (geometry) {
      if (view === 'front') {
        shell = [...geometry.sections].reverse().map((section, i) =>
          '<path class="' + (i === geometry.sections.length - 1 ? 'shell' : 'shell depth-edge') +
          '" d="' + frontPath(section, p, scale) + '"/>').join('');
      } else {
        for (const section of geometry.sections) {
          const points = section.samples;
          for (const z of [section.z2, section.z1]) {
            shell += shape(points.map(([x, y]) => [x, y, z]), z ? 'hidden-edge' : 'shell');
          }
          for (const [i, a] of points.entries()) {
            const b = points[(i + 1) % points.length];
            if (i && section.corners.some(c => c.radius &&
              Math.abs(Math.hypot(a[0] - c.center[0], a[1] - c.center[1]) - c.radius) < 1e-7 &&
              a !== c.incoming && a !== c.outgoing)) continue;
            shell += edge([...a, section.z1], [...a, section.z2], b[1] > a[1] || b[0] < a[0] ?
              'profile-edge' : 'hidden-edge');
          }
        }
      }
    } else if (view === 'front') shell += shape(frontOutline(notch, W, H), 'shell');
    else {
      const back = frontOutline({ ...notch, enabled: cutAtBack }, W, H).map(([x, y]) => [x, y, D]);
      shell = shape(back, 'hidden-edge') +
        sideOutline(notch, 'left', W, H, D).map(face => shape(face, 'hidden-edge')).join('') +
        sideOutline(notch, 'right', W, H, D).map(face => shape(face, 'shell')).join('') +
        shape(frontOutline(notch, W, H), 'shell');
    }

    if (edgeThickness && view !== 'side') {
      // Clip a centred stroke to the outline so board thickness is entirely inside the cabinet.
      const section = profile.sections[0];
      const d = view === 'front' ? frontPath(section, p, scale) :
        'M ' + section.samples.map(([x, y]) => token(p([x, y, 0]))).join(' L ') + ' Z';
      const id = 'edge-board-clip-' + view + '-' + (options.sheet ?? 'editor');
      const weight = edgeThickness * scale * 2 * (view === 'iso' ? 0.87 : 1);
      shell = '<defs><clipPath id="' + id + '"><path d="' + d + '"/></clipPath></defs>' + shell +
        '<path class="edge-board" d="' + d + '" stroke-width="' + weight + '" clip-path="url(#' + id + ')"/>';
    }

    let bayHighlight = '';
    let bayLabels = '';
    let dimensions = '';
    const occupied = [];
    const recorded = new Set();
    function overall(id, a, b, value) {
      const offset = layout.callouts?.[id] ?? callouts[id];
      const a2 = p(a), b2 = p(b);
      const horizontal = a2[1] === b2[1];
      const shift = ([x, y]) => horizontal ? [x, y + offset] : [x + offset, y];
      const content = dimension(a2, b2, offset, value);
      reserve(dimensionGeometry(a2, b2, offset), offset, value);
      if (!interactive) return content;
      return '<g data-select="dim-' + id + '" data-drag="' + (horizontal ? 'callout-y' : 'callout-x') + '">' +
        content + line(shift(a2), shift(b2), 'hit') + '</g>';
    }
    function reserve(geometry, offset, value) {
      const { center, normal } = geometry;
      const at = center.map((coordinate, i) => coordinate + normal[i] * (offset < 0 ? -8 : 8));
      occupied.push({ at, width: String(value).length * 6 + 5 });
    }

    function measure(a, b, offset, key, caption) {
      const distance = Math.hypot(...a.map((value, i) => b[i] - value));
      if (!distance || recorded.has(key)) return;
      recorded.add(key);
      const value = caption ?? Math.round(distance * 10) / 10;
      const start = p(a), end = p(b);
      const { length, center, normal } = dimensionGeometry(start, end, offset);
      if (!length) return;
      const width = String(value).length * 6 + 5;
      const origin = center.map((coordinate, i) => coordinate + normal[i] * (offset < 0 ? -8 : 8));
      const step = view === 'side' ? 10 : 13;
      const widthLimit = view === 'side' ? SIDE_WIDTH : 720;
      const fits = ([x, y]) => x > width / 2 + 2 && x < widthLimit - width / 2 - 2 && y > 30 && y < 604 &&
        occupied.every(({ at: [otherX, otherY], width: otherWidth }) =>
          Math.abs(x - otherX) > (width + otherWidth) / 2 || Math.abs(y - otherY) >= 12);
      const alternatives = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [-1, 1], [1, -1]];
      let at;
      for (let ring = 1; ring <= 12 && !at; ring++) {
        at = alternatives.map(([x, y]) => [origin[0] + x * step * ring, origin[1] + y * step * ring]).find(fits);
      }
      at ??= origin;
      occupied.push({ at, width });
      const moved = at[0] !== origin[0] || at[1] !== origin[1];
      dimensions += dimension(start, end, offset, value, moved ? at : undefined);
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
        const [clearLeft, clearRight] = M.clearBay(layout, i);
        const openingLeft = clearLeft + (i ? 0 : edgeThickness);
        const openingRight = clearRight - (i === layout.dividers.length ? edgeThickness : 0);
        measure([openingLeft, bottomEdge, 0], [openingRight, bottomEdge, 0], 25,
          'column-' + i, width === openingRight - openingLeft ? width : undefined);
        if (width > 175) {
          const text = bay.name.trim() || 'Bay ' + (i + 1);
          const max = Math.max(4, Math.floor(width * scale / 7));
          const display = text.length > max ? text.slice(0, max - 1) + '…' : text;
          bayLabels += group('bay-' + i, '', label(cx, cy, display, 'bay-label'));
        }
      }
    }
    if (view === 'side') {
      const first = bay === 0;
      if (first) dimensions += overall('side-depth', [0, topEdge, 0], [0, topEdge, D], D + ' D');
      dimensions += label(p([0, 0, 0])[0], 560, 'Front', 'drawing-label') +
        label(p([0, 0, D])[0], 560, 'Back', 'drawing-label');
      const name = layout.bays[bay].name.trim();
      bayLabels += group('bay-' + bay, '', label(SIDE_WIDTH / 2, 28,
        'Bay ' + (bay + 1) + (name ? ' · ' + (name.length > 23 ? name.slice(0, 22) + '…' : name) : ''), 'side-title'));
    }
    if (view === 'front' || view === 'side' && bay === 0) {
      dimensions += overall(view + '-height', [leftEdge, bottomEdge, 0], [leftEdge, topEdge, 0],
        Math.round(topEdge - bottomEdge) + ' H');
    }
    if (view === 'iso') {
      measure([leftEdge, bottomEdge, 0], [rightEdge, bottomEdge, 0], 27, 'overall-w');
      measure([rightEdge, bottomEdge, 0], [rightEdge, bottomEdge, D], 25, 'overall-d');
      measure([leftEdge, bottomEdge, 0], [leftEdge, topEdge, 0], -33, 'overall-h');
    }

    let cut = '';
    if (notch.enabled && !geometry && (view !== 'side' || bay === (notch.side === 'left' ? 0 : layout.dividers.length))) {
      if (view === 'front') {
        const outline = [ [outerEdge, ny1, 0], [recessEdge, ny1, 0],
          [recessEdge, ny2, 0], [outerEdge, ny2, 0] ];
        cut = group('notch', 'y', shape(outline, 'notch-edge', false) +
          (!cutAtBack ? shape(rectXY(nx1, nx2, ny1, ny2, depth), 'notch-face') : ''),
          shape(outline, 'hit', false));
        measure([nx1, ny1, 0], [nx2, ny1, 0], 15, 'notch-width');
        const offset = notch.side === 'left' ? -15 : 25;
        measure([outerEdge, ny1, 0], [outerEdge, ny2, 0], offset, 'notch-height');
        measure([outerEdge, 0, 0], [outerEdge, ny1, 0], offset, 'notch-y');
      } else if (view === 'side') {
        const [frontBottom, backBottom, backTop, frontTop] = rectYZ(ny1, ny2, 0, depth, outerEdge);
        const outline = side !== notch.side ? shape([frontBottom, backBottom, backTop, frontTop], 'hidden-edge') :
          edge(frontBottom, backBottom, 'notch-edge') + edge(frontTop, backTop, 'notch-edge') +
          (cutAtBack ? '' : edge(backBottom, backTop, 'notch-edge'));
        cut = group('notch', '', shape([frontBottom, backBottom, backTop, frontTop], 'notch-face') + outline);
        measure([0, ny2, 0], [0, ny2, depth], -16, 'notch-depth');
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
        measure([nx1, ny1, 0], [nx2, ny1, 0], 14, 'notch-width');
        measure([recessEdge, ny1, 0], [recessEdge, ny2, 0], 15, 'notch-height');
        measure([recessEdge, ny1, 0], [recessEdge, ny1, depth], -18, 'notch-depth');
      }
    }

    const dividers = view === 'side' ? '' : layout.dividers.map((x, i) => {
      if (geometry) {
        let content = '', hits = '';
        for (const section of geometry.sections) {
          for (const [low, high] of Outline.intervals(section, x, true)) {
            if (high - low < 1e-7) continue;
            const face = rectYZ(low, high, section.z1, section.z2, x);
            content += view === 'front' && internal ?
              shape(rectXY(x - internal / 2, x + internal / 2, low, high, section.z1), 'piece board') :
              view === 'front' ? edge(face[0], face[3], 'piece main-divider') : shape(face, 'piece main-divider');
            hits += edge(face[0], face[3], 'hit');
          }
        }
        return group('main-' + i, 'x', content, hits);
      }
      const face = rectYZ(edgeThickness, H - edgeThickness, 0, D, x);
      const board = shape(rectXY(x - internal / 2, x + internal / 2, edgeThickness, H - edgeThickness, 0), 'piece board');
      return group('main-' + i, 'x',
        view === 'front' && internal ? board :
          view === 'front' ? edge(face[0], face[3], 'piece main-divider') : shape(face, 'piece main-divider'),
        edge(face[0], face[3], 'hit'));
    }).join('');

    function drawDrawer(part) {
      const [x1, x2, y1, y2, z1, z2] = M.drawerBounds(layout, part, view === 'front' ? 0 : travel[part.id] ?? 0);
      if (view === 'front') {
        const [x, y] = p([(x1 + x2) / 2, (y1 + y2) / 2, z1]);
        return group(part.id, 'xy', shape(rectXY(x1, x2, y1, y2, z1), 'piece drawer-front') +
          line([x - 7, y], [x + 7, y], 'drawer-pull'));
      }
      const closed = view === 'side' && travel[part.id] ?
        shape(rectYZ(y1, y2, part.z, part.z + part.depth, x1), 'hidden-edge') : '';
      const bottom = y1 + internal;
      const walls = view === 'side' ? [
        rectYZ(y1, y2, z1, z2, x1), rectYZ(y1, bottom, z1, z2, x1),
        rectYZ(bottom, y2, z1, z1 + internal, x1), rectYZ(bottom, y2, z2 - internal, z2, x1),
      ] : [
        rectXZ(x1, x2, z1, z2, bottom), rectYZ(bottom, y2, z1, z2, x2),
        rectXY(x1, x2, y1, y2, z1), rectXY(x1, x2, bottom, y2, z2),
        rectYZ(bottom, y2, z1, z2, x1), rectYZ(bottom, y2, z1 + internal, z2 - internal, x2 - internal),
      ];
      return group(part.id, '', closed + walls.map(face => shape(face, 'piece drawer-front')).join(''));
    }

    function drawPart(part) {
      const [x1, x2, y1, y2, z1, z2] = partBounds(layout, part, partGeometry);
      if (part.type === 'drawer') return drawDrawer(part);
      if (part.type === 'rack') {
        if (view !== 'iso' && view !== 'side') {
          const face = rectXY(x1, x2, y1, y2, z1);
          const [x, y] = p([(x1 + x2) / 2, (y1 + y2) / 2, z1]);
          const boards = internal ? shape(rectXY(x1 + internal, x2 - internal, y1 + internal,
            y2 - internal, z1), 'piece rack-opening') : '';
          return group(part.id, 'xy', shape(face, 'piece rack-wall') + boards +
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
      let drawing = view === 'front' ? edge(start, end, 'piece') : shape(face, 'piece shelf-plane');
      if (internal) {
        if (view === 'front') drawing = shape(rectXY(x1, x2, y1, y2, z1), 'piece board');
        if (view === 'side') drawing = shape(rectYZ(y1, y2, z1, z2, x1), 'piece board');
        if (view === 'iso') drawing += (shelf ? [
          rectXY(x1, x2, y1, y2, z1), rectYZ(y1, y2, z1, z2, x2), rectXZ(x1, x2, z1, z2, y2),
        ] : [rectXY(x1, x2, y1, y2, z1), rectXZ(x1, x2, z1, z2, y2), rectYZ(y1, y2, z1, z2, x2)])
          .map(surface => shape(surface, 'piece board')).join('');
      }
      const sideHit = y1 === y2 ? edge([x1, y1, z1], [x1, y1, z2], 'hit') : '';
      return group(part.id, shelf ? 'y' : 'xy', drawing, view === 'side' ? sideHit : edge(start, end, 'hit'));
    }

    const visibleParts = view === 'side' ? layout.parts.filter(part => part.bay === bay) : layout.parts;
    const parts = visibleParts.map(drawPart).join('');
    let controls = '';
    const selectedPart = visibleParts.find(item => item.id === selected);
    if (interactive && selectedPart && view !== 'iso') {
      const part = selectedPart;
      const bounds = partBounds(layout, part, partGeometry);
      const [x1, x2, y1, y2, z1, z2] = bounds;
      if (view === 'front' && (part.type === 'divider' || M.isBox(part))) {
        const [x, y] = p([x2, y2, 0]);
        const origin = [x + 10, y - 10];
        controls += [['x', [origin[0] + 14, origin[1]]], ['y', [origin[0], origin[1] - 14]]].map(([axis, end]) =>
          '<g class="move-handle" data-select="' + escape(part.id) + '" data-drag="' + axis + '">' +
          line(origin, end, 'move-axis move-' + axis) + line(origin, end, 'hit') +
          '<circle cx="' + end[0] + '" cy="' + end[1] + '" r="5"/>' +
          label(end[0], end[1] + 2.5, axis.toUpperCase(), 'move-label') + '</g>').join('');
      }
      const handle = (x, y, z, fields) => {
        const [cx, cy] = p([x, y, z]);
        return '<g class="resize-handle" data-select="' + escape(part.id) + '" data-drag="resize-' + fields + '">' +
          '<circle class="resize-hit" cx="' + cx + '" cy="' + cy + '" r="9"/>' +
          '<rect x="' + (cx - 3.5) + '" y="' + (cy - 3.5) + '" width="7" height="7" rx="1"/></g>';
      };
      const centerX = (x1 + x2) / 2, centerY = (y1 + y2) / 2, centerZ = (z1 + z2) / 2;
      if (view === 'front') {
        if (part.type !== 'divider') {
          controls += handle(x1, centerY, z1, 'x1') + handle(x2, centerY, z1, 'x2');
        }
        if (part.type === 'divider' || M.isBox(part)) {
          controls += handle(centerX, y1, z1, 'y1') + handle(centerX, y2, z1, 'y2');
        }
        if (M.isBox(part) && (x2 - x1) * scale > 25 && (y2 - y1) * scale > 25) {
          controls += handle(x1, y1, z1, 'x1-y1') + handle(x2, y1, z1, 'x2-y1') +
            handle(x1, y2, z1, 'x1-y2') + handle(x2, y2, z1, 'x2-y2');
        }
      } else if (part.type !== 'rail') {
        const shift = part.type === 'drawer' ? part.travel * (travel[part.id] ?? 0) : 0;
        controls += handle(x1, centerY, z1 - shift, 'z1') + handle(x1, centerY, z2 - shift, 'z2');
        if (part.type === 'divider' || M.isBox(part)) {
          controls += handle(x1, y1, centerZ - shift, 'y1') + handle(x1, y2, centerZ - shift, 'y2');
        }
      }
    }
    if (interactive && view === 'front') {
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
    if (full) {
      const heightAt = (y, x, z, offset) => measure([x, bottomEdge, z], [x, y, z], offset, 'height-' + y);
      const featureList = M.shapeEdits(layout);
      for (const feature of featureList) {
        if (feature.id === 'notch' && !custom) continue;
        const [a, b, c, d] = Outline.featureBox(feature);
        const z = feature.z1;
        if (view === 'side') {
          const [left, right] = bayBounds(layout, bay);
          if ((bay && b <= left) || (bay !== layout.dividers.length && a >= right)) continue;
          heightAt(c, a, z, -25);
          measure([a, c, z], [a, d, z], -25, 'feature-y-' + c + '-' + d);
          measure([a, d, z], [a, d, feature.z2], -16, 'feature-z-' + z + '-' + feature.z2 + '-' + d);
        } else {
          heightAt(c, a, z, -18);
          measure([a, c, z], [b, c, z], 16, 'feature-x-' + a + '-' + b + '-' + c);
          measure([b, c, z], [b, d, z], 17, 'feature-y-' + b + '-' + c + '-' + d);
          if (view === 'iso') measure([b, d, z], [b, d, feature.z2], -16, 'feature-z-' + feature.id);
        }
      }
      if (view !== 'side') {
        for (const { x, y, z, radius } of layout.radii ?? []) {
          if (!radius) continue;
          const [cx, cy] = p([x, y, z]);
          dimensions += line([cx, cy], [cx + 13, cy - 15], 'dimension extension') +
            label(cx + 19, cy - 19, 'R' + radius);
          occupied.push({ at: [cx + 19, cy - 19], width: String(radius).length * 6 + 11 });
        }
      }
      for (const part of visibleParts) {
        const [x1, x2, y1, y2, z1, z2] = partBounds(layout, part, partGeometry);
        const y = part.type === 'shelf' ? y2 : y1;
        const local = view === 'side' ? 'side-' : 'front-';
        if (view === 'front') {
          const [left, right] = M.clearBay(layout, part.bay);
          const openingLeft = part.bay ? left : left + edgeThickness;
          const openingRight = part.bay === layout.dividers.length ? right - edgeThickness : right;
          heightAt(y, x1, z1, -24);
          if (y2 > y1 && part.type !== 'shelf') {
            measure([x2, y1, z1], [x2, y2, z1], 14, local + 'part-height-' + part.id);
          }
          if (x1 !== openingLeft) {
            measure([openingLeft, y, z1], [x1, y, z1], -13, local + 'start-' + x1 + '-' + y + '-' + part.bay);
          }
          if (part.type !== 'divider' && (x1 !== openingLeft || x2 !== openingRight)) {
            measure([x1, y, z1], [x2, y, z1], -13, local + 'span-' + x1 + '-' + x2 + '-' + y);
          }
        } else if (view === 'side') {
          if (z1 || z2 !== D) {
            measure([0, y, 0], [0, y, z1], -13, local + 'start-' + z1 + '-' + y);
            measure([0, y, z1], [0, y, z2], -13, local + 'span-' + z1 + '-' + z2 + '-' + y);
          }
          if (part.type === 'rail') measure([0, y, 0], [0, y, z1], -13, local + 'start-' + z1 + '-' + y);
          if (z2 > z1 && y2 > y1 && part.type !== 'shelf') {
            measure([0, y1, z2], [0, y2, z2], 16, local + 'part-height-' + y1 + '-' + y2 + '-' + z2);
          }
          heightAt(y, 0, z1, -19);
        } else {
          if (part.type !== 'divider') {
            measure([x1, y2, z1], [x2, y2, z1], -12, 'part-width-' + x1 + '-' + x2 + '-' + y2 + '-' + z1);
          }
          if (z1 || z2 !== D) {
            measure([x2, y2, z1], [x2, y2, z2], -15, 'part-depth-' + x2 + '-' + y2 + '-' + z1 + '-' + z2);
          }
          if (M.isBox(part) || part.type === 'divider') {
            measure([x1, y1, z1], [x1, y2, z1], -15, 'part-height-' + part.id);
          }
        }
        if (view !== 'front' && M.isBox(part)) {
          const parked = part.type === 'rack' ? rackGeometry(part, 0, D).startZ : z1;
          measure([x1, y1, parked - part.travel], [x1, y1, parked], 20,
            'travel-' + part.id, part.travel + ' travel');
        }
      }
      if (edgeThickness || internal) {
        const caption = [edgeThickness ? 'Edge ' + edgeThickness : '', internal ? 'Internal ' + internal : '']
          .filter(Boolean).join(' · ');
        if (view !== 'side' || bay === 0) dimensions += label(view === 'side' ? SIDE_WIDTH / 2 : 360, 595, caption, 'dimension-label');
      }
    }
    return bayHighlight + shell + cut + dividers + parts + bayLabels + dimensions + controls +
      (view === 'side' ? '' : axes(view));
  }

  window.WardrobeDrawing = { render, frame, callouts, SIDE_WIDTH };
}());
