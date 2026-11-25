(function () {
  'use strict';

  const W = 1821;
  const H = 2600;
  const D = 600;
  const MIN_BAY = 100;
  const defaultSize = { width: W, height: H, depth: D };
  const Outline = typeof module === 'object' ? require('./outline.js') : window.WardrobeOutline;
  const TYPES = { shelf: 'Shelf', divider: 'Short divider', rail: 'Clothes rail', rack: 'Pull-out rack', drawer: 'Drawer' };
  const OWNERS = { none: 'Unassigned', first: 'Person 1', second: 'Person 2', shared: 'Shared' };
  const DEFAULT_NOTCH = { enabled: false, side: 'left', y: 600, height: 300, width: 300, depth: 350 };
  const reservedId = /^(notch|cabinet|columns|outline|radius-new|(?:bay|main|dim|outline|radius)-.+)$/;
  const inside = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
  const overlap = (a, b) => [0, 2, 4].every(i => a[i] < b[i + 1] && b[i] < a[i + 1]);

  function bayBounds(layout, bay) {
    return [layout.dividers[bay - 1] ?? 0, layout.dividers[bay] ?? sizeOf(layout).width];
  }

  const defaultThickness = { internal: 18, edge: 18 };
  const thicknessOf = layout => layout.thickness ?? { internal: 0, edge: 0 };
  const isBox = part => part.type === 'rack' || part.type === 'drawer';
  const clearBay = (layout, bay) => {
    const [left, right] = bayBounds(layout, bay);
    const half = thicknessOf(layout).internal / 2;
    return [left + (bay ? half : 0), right - (bay < layout.dividers.length ? half : 0)];
  };

  function sizeOf(layout) {
    return layout.size ?? defaultSize;
  }

  function notchBox({ side, y, height, width, depth }, cabinetWidth = W) {
    const [x1, x2] = side === 'left' ? [0, width] : [cabinetWidth - width, cabinetWidth];
    return [x1, x2, y, y + height, 0, depth];
  }

  function shapeEdits(layout) {
    const notch = layout.notch;
    const legacy = notch.enabled ? [{ id: 'notch', kind: 'cut', edge: notch.side,
      at: notch.side === 'left' ? 0 : sizeOf(layout).width,
      start: notch.y, end: notch.y + notch.height, offset: notch.width, z1: 0, z2: notch.depth }] : [];
    return [...legacy, ...(layout.features ?? [])];
  }

  function outlineGeometry(layout) {
    return Outline.build(sizeOf(layout), shapeEdits(layout), layout.radii);
  }

  function hasCustomOutline(layout) {
    return Boolean(layout.features?.length || layout.radii?.length);
  }

  function intersectSpans(first, second) {
    return first.flatMap(([a, b]) => second.map(([c, d]) => [Math.max(a, c), Math.min(b, d)])
      .filter(([lo, hi]) => hi >= lo));
  }

  function clearSpans(layout, bay, y1, y2, z1, z2, geometry) {
    const edge = thicknessOf(layout).edge;
    const [left, right] = clearBay(layout, bay);
    if (!geometry && !edge) return [[left, right]];
    const profile = geometry ?? outlineGeometry(layout);
    if (profile.error) return [];
    const minimum = bay === 0 ? -Infinity : left;
    const maximum = bay === layout.dividers.length ? Infinity : right;
    if (!edge && y1 === y2) {
      return profile.slices(y1, z1, z2)
        .map(([a, b]) => [Math.max(minimum, a), Math.min(maximum, b)]).filter(([a, b]) => b >= a);
    }
    const low = y1 - edge, high = y2 + edge;
    const depth = sizeOf(layout).depth;
    const front = Math.max(0, z1 - edge), back = Math.min(depth, z2 + edge);
    const sections = profile.sections.filter(s => front === back ? s.z1 <= front && s.z2 >= back :
      s.z1 < back && s.z2 > front);
    const ranges = sections.map(section => {
      const breaks = [...new Set([low, high, ...section.corners.flatMap(c => [c.incoming[1], c.outgoing[1]])
        .filter(y => y > low && y < high)])].sort((a, b) => a - b);
      const probes = [...breaks];
      // Check both sides of a step, so sitting on a cut boundary cannot hide an interference.
      for (let i = 1; i < breaks.length; i++) {
        const inset = Math.min((breaks[i] - breaks[i - 1]) / 4, 1e-6);
        probes.push(breaks[i - 1] + inset, breaks[i] - inset);
      }
      return probes.map(y => Outline.intervals(section, y)
        .map(([a, b]) => [Math.max(minimum, a + edge), Math.min(maximum, b - edge)])
        .filter(([a, b]) => b >= a)).reduce(intersectSpans);
    });
    if (!ranges.length) return [];
    return !edge && front === back ? ranges.flat() : ranges.reduce(intersectSpans);
  }

  function usableSpan(layout, bay, y, z1, z2, geometry, y2 = y) {
    const [left] = bayBounds(layout, bay);
    const { internal, edge } = thicknessOf(layout);
    const spans = clearSpans(layout, bay, y, y2, z1, z2, geometry);
    const candidates = internal || edge ? spans :
      spans.map(([a, b]) => [Math.ceil(a - 1e-7) || 0, Math.floor(b + 1e-7) || 0]);
    return candidates.filter(([a, b]) => b > a)
      .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] ?? [left, left];
  }

  function railSupports(layout, part, endpoint) {
    const sign = endpoint === 'x1' ? 1 : -1;
    const half = thicknessOf(layout).internal / 2;
    const index = part.bay - Number(endpoint === 'x1');
    const main = layout.dividers[index];
    const supports = main === undefined ? [] : [{ anchor: 'main-' + index, x: main + sign * half }];
    for (const item of layout.parts) {
      if (item.type === 'divider' && item.bay === part.bay && part.y >= item.y1 && part.y <= item.y2 &&
          part.z >= item.z1 && part.z <= item.z2) {
        supports.push({ anchor: item.id, x: item.x + sign * half });
      }
    }
    return supports;
  }

  function railEndpoint(layout, part, endpoint, fallback) {
    const anchor = part[endpoint + 'Anchor'];
    return (anchor && railSupports(layout, part, endpoint).find(item => item.anchor === anchor)?.x) ??
      part[endpoint] ?? fallback;
  }

  function releaseRailAnchors(layout, original) {
    for (const rail of layout.parts.filter(part => part.type === 'rail')) {
      for (const endpoint of ['x1', 'x2']) {
        const key = endpoint + 'Anchor';
        if (!rail[key] || railSupports(layout, rail, endpoint).some(support => support.anchor === rail[key])) continue;
        const previous = original.parts.find(part => part.id === rail.id);
        const coordinate = endpoint === 'x1' ? 0 : 1;
        rail[endpoint] = previous ? Math.round(partBounds(original, previous)[coordinate]) : rail[endpoint];
        delete rail[key];
      }
    }
  }

  function partBounds(layout, part, geometry = hasCustomOutline(layout) || thicknessOf(layout).edge ?
    outlineGeometry(layout) : undefined) {
    const half = thicknessOf(layout).internal / 2;
    switch (part.type) {
      case 'shelf': {
        const [a, b] = usableSpan(layout, part.bay, part.y - half, part.z1, part.z2, geometry, part.y + half);
        return [part.x1 ?? a, part.x2 ?? b, part.y - half, part.y + half, part.z1, part.z2];
      }
      case 'rail': {
        const [a, b] = usableSpan(layout, part.bay, part.y, part.z, part.z, geometry);
        return [railEndpoint(layout, part, 'x1', a), railEndpoint(layout, part, 'x2', b),
          part.y, part.y, part.z, part.z];
      }
      case 'divider':
        return [part.x - half, part.x + half, part.y1, part.y2, part.z1, part.z2];
      case 'rack':
      case 'drawer':
        return [part.x, part.x + part.width, part.y, part.y + part.height, part.z, part.z + part.depth];
    }
  }

  function drawerBounds(layout, part, fraction) {
    const bounds = partBounds(layout, part);
    bounds[4] -= part.travel * fraction;
    bounds[5] -= part.travel * fraction;
    return bounds;
  }

  function rackGeometry(part, fraction, cabinetDepth = D) {
    const [front, back] = [part.z, part.z + part.depth];
    const inset = Math.min(35, part.depth / 5);
    const stowedStart = front + inset;
    const stowedEnd = Math.min(back - inset, part.travel - 20);
    return {
      x: part.x + part.width / 2, y: part.y + part.height * 0.74,
      mountZ: cabinetDepth, sleeveBack: back,
      startZ: stowedStart - part.travel * fraction,
      endZ: stowedEnd - part.travel * fraction,
    };
  }

  function makePart(layout, type, bay, id) {
    const { height, depth } = sizeOf(layout);
    const { internal, edge } = thicknessOf(layout);
    const [a, b] = clearBay(layout, bay);
    const left = Math.ceil(a + (bay ? 0 : edge)), right = Math.floor(b - (bay === layout.dividers.length ? edge : 0));
    const bottom = edge, top = height - edge;
    const base = { id, type, bay };
    switch (type) {
      case 'shelf':
        return { ...base, x1: null, x2: null, y: Math.max(Math.ceil(bottom + internal / 2), Math.min(Math.floor(top - internal / 2), 1300)), z1: 0, z2: depth };
      case 'rail':
        return { ...base, x1: null, x2: null, y: Math.max(bottom, Math.min(top, 1720)), z: Math.min(depth, 300) };
      case 'divider':
        return { ...base, x: left + Math.floor((right - left) / 2), y1: Math.max(bottom, Math.min(1000, top - 1)),
          y2: Math.min(1500, top), z1: 0, z2: depth };
      case 'rack': {
        const width = Math.min(180, right - left);
        return { ...base, x: left + Math.floor((right - left - width) / 2), y: Math.min(Math.max(bottom, 1030), Math.max(bottom, top - 240)),
          width, height: Math.min(240, top - bottom), z: 0, depth: Math.min(575, depth), travel: Math.min(550, depth + 20) };
      }
      case 'drawer': {
        const width = Math.min(right - left, 450);
        const drawerHeight = Math.min(180, top - bottom);
        const drawerDepth = Math.min(500, depth);
        return { ...base, x: left + Math.floor((right - left - width) / 2),
          y: bottom, z: 0, width, height: drawerHeight, depth: drawerDepth, travel: drawerDepth };
      }
    }
  }

  function createLayout(count) {
    const layout = {
      dividers: count === 3 ? [607, 1214] : [455, 910, 1366],
      bays: Array.from({ length: count }, () => ({ name: '', owner: 'none' })),
      parts: [],
      notch: { ...DEFAULT_NOTCH },
      size: { ...defaultSize },
      features: [],
      radii: [],
      callouts: {},
      thickness: { ...defaultThickness },
    };
    function add(type, bay, fields = {}) {
      const id = 'starter-' + (layout.parts.length + 1);
      layout.parts.push({ ...makePart(layout, type, bay, id), ...fields });
    }
    for (let bay = 0; bay < count; bay++) {
      add('shelf', bay, { y: 2110 });
      if (bay === 0 || bay === count - 1) {
        add('rail', bay);
      } else {
        for (const y of [420, 820, 1390, 1750]) add('shelf', bay, { y });
      }
    }
    add('rack', 1);
    return layout;
  }

  function createDocument() {
    return { version: 2, active: 3, layouts: { 3: createLayout(3), 4: createLayout(4) } };
  }

  function validateNotch(layout) {
    const notch = layout.notch;
    const { width, height, depth } = sizeOf(layout);
    if (!notch || typeof notch.enabled !== 'boolean' || !['left', 'right'].includes(notch.side)) {
      return 'The side notch needs a valid side and on/off setting.';
    }
    if (!inside(notch.width, 1, notch.enabled ? width : Infinity)) return 'Set a valid notch width within the cabinet.';
    if (!inside(notch.depth, 1, notch.enabled ? depth : Infinity)) return 'Set a valid notch depth within the cabinet.';
    if (!inside(notch.y, 1, notch.enabled ? height - 2 : Infinity) ||
        !inside(notch.height, 1, notch.enabled ? height - 1 - notch.y : Infinity)) {
      return 'Keep the notch opening between the cabinet top and bottom.';
    }
    if (!notch.enabled) return '';
    const bay = notch.side === 'left' ? 0 : layout.bays.length - 1;
    const [left, right] = bayBounds(layout, bay);
    if (notch.width > right - left) {
      return 'The notch must fit inside the ' + notch.side + ' outer bay (' + (right - left) + ' mm).';
    }
    return '';
  }

  function validatePart(layout, part, geometry) {
    const name = TYPES[part.type];
    const { width, height: cabinetHeight, depth } = sizeOf(layout);
    const bay = bayBounds(layout, part.bay);
    const left = geometry && part.bay === 0 ? geometry.bounds[0] : bay[0];
    const right = geometry && part.bay === layout.bays.length - 1 ? geometry.bounds[1] : bay[1];
    const [x1, x2, y1, y2, z1, z2] = partBounds(layout, part, geometry);
    const spanning = part.type === 'shelf' || part.type === 'rail';
    if (spanning && ![part.x1, part.x2].every(x => x === null || Number.isInteger(x))) {
      return name + ' needs whole-millimetre X coordinates or bay-edge anchors.';
    }
    const fields = part.type === 'shelf' ? ['y', 'z1', 'z2'] : part.type === 'rail' ? ['y', 'z'] :
      part.type === 'divider' ? ['x', 'y1', 'y2', 'z1', 'z2'] : ['x', 'y', 'z', 'width', 'height', 'depth'];
    if (!fields.every(key => Number.isSafeInteger(part[key]))) return name + ' needs whole-millimetre dimensions.';
    if (part.type === 'rail' && ['x1', 'x2'].some(endpoint => part[endpoint + 'Anchor'] !== undefined &&
        !railSupports(layout, part, endpoint).some(support => support.anchor === part[endpoint + 'Anchor']))) {
      return 'A clothes rail attachment must meet a vertical divider in its column.';
    }
    const { internal, edge } = thicknessOf(layout);
    const [bayLeft, bayRight] = clearBay(layout, part.bay);
    const minX = part.bay === 0 && geometry ? left : bayLeft + (part.bay === 0 ? edge : 0);
    const maxX = part.bay === layout.dividers.length && geometry ? right :
      bayRight - (part.bay === layout.dividers.length ? edge : 0);
    const hasHeight = part.type === 'divider' || isBox(part);
    const [bottom, top] = geometry ? geometry.bounds.slice(2) : [0, cabinetHeight];
    if (y1 < bottom + edge || y2 > top - edge || y2 < y1 + Number(hasHeight)) {
      return name + ' needs a Y position and height within ' + (bottom + edge) + '–' + (top - edge) + ' mm.';
    }
    if (x1 < minX || x2 > maxX || (part.type === 'divider' ?
        !internal && (x1 === minX || x2 === maxX) : x2 <= x1)) {
      return name + ' must fit within Bay ' + (part.bay + 1) + ' (' + minX + '–' + maxX + ' mm).';
    }
    if (!inside(z1, 0, depth) || !inside(z2, z1 + Number(part.type !== 'rail'), depth)) {
      return name + ' needs a Z position and depth within 0–' + depth + ' mm.';
    }
    if (isBox(part) && (part.width <= 2 * internal || part.height <= (part.type === 'drawer' ? internal : 2 * internal) ||
        part.depth <= (part.type === 'drawer' ? 2 * internal : 0))) {
      return name + ' needs enough space for its boards.';
    }
    if (part.type === 'rack') {
      const rack = rackGeometry(part, 1, depth);
      if (!inside(part.travel, 1, depth + 20) || rack.endZ <= rack.startZ) {
        return 'Set travel up to ' + (depth + 20) + ' mm that brings some usable rail past the cabinet front.';
      }
    }
    if (part.type === 'drawer' && !inside(part.travel, 1, depth)) {
      return 'Set drawer travel between 1 and ' + depth + ' mm.';
    }
    if (!geometry && layout.notch.enabled && overlap([x1, x2, y1, y2, z1, z2], notchBox(layout.notch, width))) {
      return 'The notch intersects the ' + name.toLowerCase() + ' in Bay ' + (part.bay + 1) + '.';
    }
    if (geometry && (edge ?
        !clearSpans(layout, part.bay, y1, y2, z1, z2, geometry).some(([a, b]) => a <= x1 + 1e-7 && b >= x2 - 1e-7) :
        !geometry.contains([x1, x2, y1, y2, z1, z2]))) {
      const surface = layout.notch.enabled && !hasCustomOutline(layout) ? 'The notch' : 'The outline';
      return surface + ' intersects the ' + name.toLowerCase() + ' in Bay ' + (part.bay + 1) + '.';
    }
    return '';
  }

  function validateLayout(layout, count = layout?.bays?.length) {
    if (!layout || !inside(count, 1, Number.MAX_SAFE_INTEGER) || !Array.isArray(layout.bays) ||
        layout.bays.length !== count || !Array.isArray(layout.dividers) ||
        layout.dividers.length !== count - 1 || !Array.isArray(layout.parts)) {
      return 'The layout needs a complete column partition.';
    }
    const { width, height, depth } = sizeOf(layout);
    if (![width, height, depth].every(value => inside(value, 1, 100000))) {
      return 'Enter cabinet dimensions from 1 to 100,000 mm.';
    }
    const { internal, edge } = thicknessOf(layout);
    if (layout.thickness !== undefined && (!layout.thickness || !inside(internal, 0, 100000) || !inside(edge, 0, 100000))) {
      return 'Set both board thicknesses to non-negative whole millimetres.';
    }
    const legacy = layout.legacyPartition;
    const min = width === W && [3, 4].includes(count) && legacy?.width === width && Array.isArray(legacy.dividers) &&
      legacy.dividers.length === layout.dividers.length && legacy.dividers.every((x, i) => x === layout.dividers[i])
      ? 1 : MIN_BAY;
    const bounds = [0, ...layout.dividers, width];
    for (let i = 1; i < bounds.length; i++) {
      if (!inside(bounds[i], bounds[i - 1] + min, width)) {
        return 'Keep dividers in order and leave at least ' + min + ' mm in each column.';
      }
    }
    const noOpening = layout.bays.some((_, i) => {
      const [left, right] = clearBay(layout, i);
      return right - left <= edge * (Number(i === 0) + Number(i === count - 1));
    });
    if (2 * edge >= height || noOpening) return 'Board thickness leaves no clear opening in a column.';
    for (const bay of layout.bays) {
      if (!bay || typeof bay.name !== 'string' || bay.name.length > 40 ||
          !Object.hasOwn(OWNERS, bay.owner)) return 'Each bay needs a valid name and assignment.';
    }
    const notchError = validateNotch(layout);
    if (notchError) return notchError;
    const ids = new Set();
    const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(id);
    if (layout.name !== undefined && (typeof layout.name !== 'string' || layout.name.length > 40)) {
      return 'Enter a layout name up to 40 characters.';
    }
    for (const list of [layout.features ?? [], layout.radii ?? []]) {
      if (!Array.isArray(list)) return 'The layout contains an invalid outline.';
      for (const item of list) {
        if (!item || !validId(item.id) || ids.has(item.id) || reservedId.test(item.id)) {
          return 'The layout contains an invalid or duplicate outline ID.';
        }
        ids.add(item.id);
      }
    }
    if (layout.callouts !== undefined && (!layout.callouts || Array.isArray(layout.callouts) ||
        typeof layout.callouts !== 'object' || Object.entries(layout.callouts).some(([id, value]) =>
          !['front-width', 'front-height', 'side-depth', 'side-height'].includes(id) || !inside(value, -340, 340)))) {
      return 'Dimension callout offsets must be whole numbers between -340 and 340.';
    }
    const geometry = hasCustomOutline(layout) || edge ? outlineGeometry(layout) : undefined;
    if (geometry?.error) return geometry.error;
    for (const part of layout.parts) {
      if (!part || !Object.hasOwn(TYPES, part.type) || !inside(part.bay, 0, count - 1) ||
          !validId(part.id) || reservedId.test(part.id) || ids.has(part.id)) {
        return 'The layout contains an invalid or duplicate part.';
      }
      ids.add(part.id);
      const error = validatePart(layout, part, geometry);
      if (error) return error;
    }
    return '';
  }

  function parseDocument(text) {
    const document = JSON.parse(text);
    if (![1, 2].includes(document?.version) || !document.layouts || Array.isArray(document.layouts)) {
      throw new Error('This file does not use wardrobe plan version 1 or 2.');
    }
    if (![3, 4].every(key => Object.hasOwn(document.layouts, key)) ||
        !(typeof document.active === 'string' || [3, 4].includes(document.active)) ||
        !Object.hasOwn(document.layouts, document.active)) throw new Error('Choose a valid active layout.');
    for (const [id, layout] of Object.entries(document.layouts)) {
      if (!/^(3|4|custom-[a-z0-9-]{1,48})$/.test(id)) throw new Error('Invalid layout ID.');
      if (document.version === 1 && layout && ['3', '4'].includes(id)) {
        layout.size = { ...defaultSize };
        layout.features = [];
        layout.radii = [];
        layout.callouts = {};
      delete layout.thickness;
        if (Array.isArray(layout.parts)) {
          const originalIds = new Set();
          for (const part of layout.parts) {
            if (!part || typeof part.id !== 'string' || originalIds.has(part.id) ||
                /^(notch|(?:bay|main)-\d+)$/.test(part.id)) {
              throw new Error('The layout contains an invalid or duplicate part.');
            }
            originalIds.add(part.id);
          }
          for (const [i, part] of layout.parts.entries()) {
            if (!reservedId.test(part.id)) continue;
            let next = 'migrated-part-' + i;
            while (originalIds.has(next)) next += '-1';
            part.id = next;
            originalIds.add(next);
          }
        }
        if (Array.isArray(layout.dividers)) {
          const bounds = [0, ...layout.dividers, W];
          if (bounds.some((x, i) => i && x - bounds[i - 1] < MIN_BAY)) {
            layout.legacyPartition = { width: W, dividers: [...layout.dividers] };
          }
        }
      }
      if (document.version === 1 && !['3', '4'].includes(id)) throw new Error('Invalid version 1 layout.');
      const error = validateLayout(layout, id === '3' || id === '4' ? Number(id) : layout?.bays?.length);
      if (error) throw new Error(id + ' layout: ' + error);
    }
    document.version = 2;
    return document;
  }

  function repartition(source, count, acceptSpanChanges = false, positions) {
    const { width } = sizeOf(source);
    if (!inside(count, 1, Math.floor(width / MIN_BAY))) return { error: 'Leave at least 100 mm per column.' };
    const layout = structuredClone(source);
    layout.thickness ??= { ...defaultThickness };
    layout.dividers = positions ?? Array.from({ length: count - 1 }, (_, i) => Math.floor((i + 1) * width / count));
    const boundaries = [0, ...layout.dividers, width];
    if (layout.dividers.length !== count - 1 || boundaries.slice(1).some((x, i) =>
      !inside(x, boundaries[i] + MIN_BAY, width))) return { error: 'Leave at least 100 mm per column.' };
    delete layout.legacyPartition;
    const keptAssignments = new Set();
    layout.bays = Array.from({ length: count }, (_, i) => {
      const [a, b] = bayBounds(layout, i);
      const previous = source.bays.findIndex((_, j) => bayBounds(source, j).every((x, k) => x === [a, b][k]));
      if (previous >= 0) keptAssignments.add(previous);
      return previous < 0 ? { name: '', owner: 'none' } : { ...source.bays[previous] };
    });
    const geometry = hasCustomOutline(source) || thicknessOf(source).edge ? outlineGeometry(source) : undefined;
    const conflicts = [];
    const changes = [];
    for (const [i, part] of source.parts.entries()) {
      const [a, b] = partBounds(source, part, geometry);
      const bay = layout.bays.findIndex((_, j) => {
        const [left, right] = bayBounds(layout, j);
        const low = j ? left : geometry?.bounds[0] ?? left;
        const high = j < count - 1 ? right : geometry?.bounds[1] ?? right;
        if (part.type === 'divider') return a > low && b < high;
        return (part.x1 === null ? b > low : a >= low) && (part.x2 === null ? a < high : b <= high) &&
          (a + b) / 2 >= low && (a + b) / 2 <= high;
      });
      const label = TYPES[part.type] + ' in Bay ' + (part.bay + 1);
      if (bay < 0) {
        conflicts.push(label);
        continue;
      }
      layout.parts[i].bay = bay;
      for (const endpoint of ['x1', 'x2']) {
        const anchor = part[endpoint + 'Anchor'];
        if (!anchor?.startsWith('main-')) continue;
        const index = layout.dividers.indexOf(source.dividers[Number(anchor.slice(5))]);
        if (index >= 0) layout.parts[i][endpoint + 'Anchor'] = 'main-' + index;
        else {
          layout.parts[i][endpoint] = Math.round(endpoint === 'x1' ? a : b);
          delete layout.parts[i][endpoint + 'Anchor'];
        }
      }
    }
    releaseRailAnchors(layout, source);
    for (const [i, part] of source.parts.entries()) {
      const [a, b] = partBounds(source, part, geometry);
      const [newA, newB] = partBounds(layout, layout.parts[i], geometry);
      if (a !== newA || b !== newB) changes.push(TYPES[part.type] + ' in Bay ' + (part.bay + 1));
    }
    const preview = { ...layout, parts: [] };
    if (conflicts.length) return { preview, error: 'Move the proposed divider or reposition these parts: ' + conflicts.join(', ') + '.' };
    if (changes.length && !acceptSpanChanges) return { preview,
      error: 'Review and accept span changes for: ' + changes.join(', ') + '.' };
    const assignments = source.bays.flatMap((bay, i) =>
      !keptAssignments.has(i) && (bay.name || bay.owner !== 'none') ? [bay.name || 'Bay ' + (i + 1)] : []);
    const review = (changes.length ? 'Updated automatic spans: ' + changes.join(', ') + '. ' : '') +
      (assignments.length ? 'Assignments stay on the source layout for: ' + assignments.join(', ') + '.' : '');
    const error = validateLayout(layout);
    return error ? { preview, error } : { layout, review };
  }

  const model = { W, H, D, TYPES, OWNERS, bayBounds, notchBox, partBounds,
    rackGeometry, drawerBounds, isBox, thicknessOf, clearBay, railSupports, releaseRailAnchors, makePart, createDocument, validateLayout, parseDocument, sizeOf, outlineGeometry,
    shapeEdits, hasCustomOutline, usableSpan, repartition, validatePart, MIN_BAY };
  if (typeof module === 'object') module.exports = model;
  else window.WardrobeModel = model;
}());
