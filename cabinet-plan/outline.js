(function () {
  'use strict';

  const edges = { left: -1, right: 1, bottom: -1, top: 1 };
  const unique = values => [...new Set(values)].sort((a, b) => a - b);
  const pointKey = point => point.join(',');
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const pairs = array => array.map((value, index) => [value, array[(index + 1) % array.length]]);
  const epsilon = 1e-7;

  function featureBox(feature) {
    const { edge, at, start, end, kind, offset } = feature;
    const other = at + edges[edge] * (kind === 'cut' ? -offset : offset);
    const span = [Math.min(at, other), Math.max(at, other)];
    return edge === 'left' || edge === 'right' ? [...span, start, end] : [start, end, ...span];
  }

  function sectionPolygon(width, height, features) {
    const boxes = features.map(featureBox);
    const xs = unique([0, width, ...boxes.flatMap(box => box.slice(0, 2))]);
    const ys = unique([0, height, ...boxes.flatMap(box => box.slice(2))]);
    const solid = xs.slice(1).map(x => ys.slice(1).map(y => x > 0 && x <= width && y > 0 && y <= height));
    const occupied = (i, j) => solid[i]?.[j] === true;

    for (const [index, feature] of features.entries()) {
      const [x1, x2, y1, y2] = boxes[index];
      const [a, b, c, d] = [xs.indexOf(x1), xs.indexOf(x2), ys.indexOf(y1), ys.indexOf(y2)];
      const positive = edges[feature.edge] === 1;
      const vertical = feature.edge === 'left' || feature.edge === 'right';
      const boundary = vertical ? xs.indexOf(feature.at) : ys.indexOf(feature.at);
      const inside = positive ? boundary - 1 : boundary;
      const outside = positive ? boundary : boundary - 1;
      for (let i = vertical ? c : a; i < (vertical ? d : b); i++) {
        const at = side => vertical ? occupied(side, i) : occupied(i, side);
        if (!at(inside) || at(outside)) return { error: 'The feature must start on an exposed edge over its full span and depth.' };
      }
      for (let i = a; i < b; i++) {
        for (let j = c; j < d; j++) solid[i][j] = feature.kind === 'extend';
      }
    }

    const links = new Map();
    let junction = false;
    function link(a, b) {
      const key = pointKey(a);
      if (links.has(key)) junction = true;
      links.set(key, { a, b });
    }
    for (let i = 0; i < solid.length; i++) {
      for (let j = 0; j < solid[i].length; j++) {
        if (!occupied(i, j)) continue;
        const a = [xs[i], ys[j]], b = [xs[i + 1], ys[j]];
        const c = [xs[i + 1], ys[j + 1]], d = [xs[i], ys[j + 1]];
        if (!occupied(i, j - 1)) link(a, b);
        if (!occupied(i + 1, j)) link(b, c);
        if (!occupied(i, j + 1)) link(c, d);
        if (!occupied(i - 1, j)) link(d, a);
      }
    }
    const first = links.values().next().value;
    if (junction || !first) return { error: 'Keep the cabinet profile connected with a solid edge.' };
    const points = [];
    let current = first;
    while (current) {
      points.push(current.a);
      links.delete(pointKey(current.a));
      current = links.get(pointKey(current.b));
    }
    if (links.size) return { error: 'This outline would split the cabinet or create an enclosed hole.' };
    return { points: points.filter(([x, y], i) => {
      const previous = points[(i + points.length - 1) % points.length];
      const next = points[(i + 1) % points.length];
      return !(previous[0] === x && next[0] === x || previous[1] === y && next[1] === y);
    }) };
  }

  function round(points, specs) {
    const corners = points.map((point, i) => {
      const previous = points[(i + points.length - 1) % points.length];
      const next = points[(i + 1) % points.length];
      const toward = target => target.map((value, axis) => Math.sign(value - point[axis]));
      const u = toward(previous);
      const v = toward(next);
      const radius = specs.find(spec => spec.x === point[0] && spec.y === point[1])?.radius ?? 0;
      const incoming = point.map((value, axis) => value + radius * u[axis]);
      const outgoing = point.map((value, axis) => value + radius * v[axis]);
      const center = point.map((value, axis) => value + radius * (u[axis] + v[axis]));
      const sweep = u[0] * v[1] - u[1] * v[0] < 0 ? 1 : -1;
      return { point, incoming, outgoing, center, radius, sweep };
    });
    if (pairs(corners).some(([a, b]) => a.radius + b.radius > distance(a.point, b.point))) {
      return { error: 'Keep each corner radius within the adjacent straight edges and neighbouring radii.' };
    }
    const sampled = corners.flatMap(corner => {
      const { incoming, outgoing, center, radius, sweep } = corner;
      if (!radius) return [incoming];
      const angle = Math.atan2(incoming[1] - center[1], incoming[0] - center[0]);
      const steps = Math.min(256, Math.max(12, Math.ceil(Math.PI / 2 * Math.sqrt(radius / 0.08))));
      return [incoming, ...Array.from({ length: steps - 1 }, (_, i) => {
        const a = angle + sweep * (i + 1) / steps * Math.PI / 2;
        return [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)];
      }), outgoing];
    });
    const samples = sampled.filter((point, i) => distance(point, sampled[(i + 1) % sampled.length]) > epsilon);
    if (specs.some(item => item.radius) && intersectsItself(samples)) {
      return { error: 'These radii would cross another edge or corner.' };
    }
    return { corners, samples, segments: pairs(corners).map(([a, b]) => [a.outgoing, b.incoming]) };
  }

  function intersectsItself(points) {
    const segments = pairs(points).map(([a, b], index) => ({
      a, b, index, lowX: Math.min(a[0], b[0]), highX: Math.max(a[0], b[0]),
      lowY: Math.min(a[1], b[1]), highY: Math.max(a[1], b[1]),
    })).sort((a, b) => a.lowX - b.lowX);
    const direction = (a, b, c) => {
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      return Math.abs(cross) < epsilon ? 0 : Math.sign(cross);
    };
    for (const [i, a] of segments.entries()) {
      for (let j = i + 1; j < segments.length && segments[j].lowX <= a.highX + epsilon; j++) {
        const b = segments[j];
        const gap = Math.abs(a.index - b.index);
        if (gap === 1 || gap === points.length - 1 || a.highY < b.lowY - epsilon || b.highY < a.lowY - epsilon) continue;
        if (direction(a.a, a.b, b.a) * direction(a.a, a.b, b.b) <= 0 &&
            direction(b.a, b.b, a.a) * direction(b.a, b.b, a.b) <= 0) return true;
      }
    }
    return false;
  }

  function intervals(section, y, swap = false) {
    const axes = swap ? [1, 0] : [0, 1];
    const [u, v] = axes;
    const intersections = [];
    const spans = [];
    for (const [a, b] of section.segments) {
      if (a[v] === b[v]) {
        if (Math.abs(a[v] - y) < epsilon) spans.push([Math.min(a[u], b[u]), Math.max(a[u], b[u])]);
      } else if (y >= Math.min(a[v], b[v]) && y < Math.max(a[v], b[v])) {
        intersections.push(a[u] + (y - a[v]) * (b[u] - a[u]) / (b[v] - a[v]));
      }
    }
    for (const { radius, center, incoming, outgoing } of section.corners) {
      if (!radius) continue;
      const low = Math.min(incoming[v], outgoing[v]);
      const high = Math.max(incoming[v], outgoing[v]);
      if (y < low || y > high) continue;
      const sign = Math.sign(incoming[u] + outgoing[u] - center[u] * 2);
      const x = center[u] + sign * Math.sqrt(Math.max(0, radius ** 2 - (y - center[v]) ** 2));
      if (y < high) intersections.push(x);
      spans.push([x, x]);
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) spans.push(intersections.slice(i, i + 2));
    const merged = [];
    for (const span of spans.sort((a, b) => a[0] - b[0])) {
      const previous = merged.at(-1);
      if (previous && span[0] <= previous[1] + epsilon) previous[1] = Math.max(previous[1], span[1]);
      else merged.push(span);
    }
    return merged;
  }

  function build(size, features = [], radii = []) {
    const { width, height, depth } = size;
    if (!Array.isArray(features) || !Array.isArray(radii) ||
        features.some(item => !item || !Object.hasOwn(edges, item.edge) ||
          !['cut', 'extend'].includes(item.kind) ||
          ![item.at, item.start, item.end, item.offset, item.z1, item.z2].every(Number.isSafeInteger) ||
          item.offset <= 0 || item.start >= item.end || item.z1 < 0 || item.z2 > depth || item.z1 >= item.z2) ||
        radii.some(item => !item || ![item.x, item.y, item.z, item.radius].every(Number.isSafeInteger) ||
          item.radius < 0 || item.z < 0 || item.z >= depth)) {
      return { error: 'Enter a positive feature span and offset, an in-range depth, and a non-negative radius.' };
    }
    const zs = unique([0, depth, ...features.flatMap(({ z1, z2 }) => [z1, z2])]);
    const sections = [];
    for (let i = 1; i < zs.length; i++) {
      const z1 = zs[i - 1], z2 = zs[i];
      const outline = sectionPolygon(width, height, features.filter(feature => feature.z1 <= z1 && feature.z2 >= z2));
      if (outline.error) return outline;
      sections.push({ ...outline, z1, z2 });
    }
    const assignments = sections.map(() => []);
    for (const spec of radii) {
      const index = sections.findIndex(section => spec.z >= section.z1 && spec.z < section.z2);
      const matches = section => section?.points.some(([x, y]) => x === spec.x && y === spec.y);
      if (!matches(sections[index])) return { error: 'The radius must match an existing corner at its depth.' };
      let start = index;
      while (matches(sections[start - 1])) start--;
      for (let i = start; matches(sections[i]); i++) {
        if (assignments[i].some(other => other.x === spec.x && other.y === spec.y)) {
          return { error: 'Set only one radius for each corner.' };
        }
        assignments[i].push(spec);
      }
    }
    for (const [i, section] of sections.entries()) {
      const rounded = round(section.points, assignments[i]);
      if (rounded.error) return rounded;
      Object.assign(section, rounded);
    }

    function slices(y, z1, z2) {
      const applicable = sections.filter(s => z1 === z2 ? s.z1 <= z1 && z1 <= s.z2 : s.z1 < z2 && s.z2 > z1);
      const lists = applicable.map(s => intervals(s, y));
      if (z1 === z2) return lists.flat();
      return lists.reduce((left, right) => left.flatMap(a => right.map(b => [
        Math.max(a[0], b[0]), Math.min(a[1], b[1]),
      ]).filter(span => span[0] <= span[1])), lists.shift() ?? []);
    }

    function contains([x1, x2, y1, y2, z1, z2]) {
      const applicable = sections.filter(s => z1 === z2 ? s.z1 <= z1 && z1 <= s.z2 : s.z1 < z2 && s.z2 > z1);
      if (!applicable.length) return false;
      const fits = section => {
        const ys = unique([y1, y2, ...section.corners.flatMap(c => [c.incoming[1], c.outgoing[1]])
          .filter(y => y > y1 && y < y2)]);
        const probes = [...ys];
        for (let i = 1; i < ys.length; i++) {
          const span = ys[i] - ys[i - 1];
          const inset = Math.min(span / 4, 1e-6);
          probes.push(ys[i - 1] + inset, ys[i] - inset);
        }
        return probes.every(y => intervals(section, y).some(([a, b]) => a <= x1 + epsilon && b >= x2 - epsilon));
      };
      return z1 === z2 ? applicable.some(fits) : applicable.every(fits);
    }

    const points = sections.flatMap(section => section.samples);
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    return { error: '', sections, contains, slices, bounds: [Math.min(...xs), Math.max(...xs),
      Math.min(...ys), Math.max(...ys)] };
  }

  const outline = { build, featureBox, intervals };
  if (typeof module === 'object') module.exports = outline;
  else window.WardrobeOutline = outline;
}());
