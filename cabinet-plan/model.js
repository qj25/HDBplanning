(function () {
  'use strict';

  const W = 1821;
  const H = 2600;
  const D = 600;
  const MIN_BAY = 100;
  const defaultSize = { width: W, height: H, depth: D };
  const Outline = typeof module === 'object' ? require('./outline.js') : window.WardrobeOutline;
  const TYPES = { shelf: 'Shelf', divider: 'Short divider', rail: 'Clothes rail', rack: 'Pull-out rack' };
  const OWNERS = { none: 'Unassigned', first: 'Person 1', second: 'Person 2', shared: 'Shared' };
  const DEFAULT_NOTCH = { enabled: false, side: 'left', y: 600, height: 300, width: 300, depth: 350 };
  const reservedId = /^(notch|cabinet|columns|outline|radius-new|(?:bay|main|dim|outline|radius)-.+)$/;
  const inside = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
  const overlap = (a, b) => [0, 2, 4].every(i => a[i] < b[i + 1] && b[i] < a[i + 1]);

  function bayBounds(layout, bay) {
    return [layout.dividers[bay - 1] ?? 0, layout.dividers[bay] ?? sizeOf(layout).width];
  }

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

  function usableSpan(layout, bay, y, z1, z2, geometry) {
    const [left, right] = bayBounds(layout, bay);
    if (!geometry || geometry.error) return [left, right];
    const minimum = bay === 0 ? -Infinity : left;
    const maximum = bay === layout.bays.length - 1 ? Infinity : right;
    return geometry.slices(y, z1, z2)
      .map(([a, b]) => [Math.ceil(Math.max(minimum, a) - 1e-7), Math.floor(Math.min(maximum, b) + 1e-7)])
      .filter(([a, b]) => b > a)
      .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0] ?? [left, left];
  }

  function partBounds(layout, part, geometry = hasCustomOutline(layout) ? outlineGeometry(layout) : undefined) {
    const [left, right] = bayBounds(layout, part.bay);
    const span = (z1, z2) => geometry ? usableSpan(layout, part.bay, part.y, z1, z2, geometry) : [left, right];
    switch (part.type) {
      case 'shelf': {
        const [a, b] = span(part.z1, part.z2);
        return [part.x1 ?? a, part.x2 ?? b, part.y, part.y, part.z1, part.z2];
      }
      case 'rail': {
        const [a, b] = span(part.z, part.z);
        return [part.x1 ?? a, part.x2 ?? b, part.y, part.y, part.z, part.z];
      }
      case 'divider':
        return [part.x, part.x, part.y1, part.y2, part.z1, part.z2];
      case 'rack':
        return [part.x, part.x + part.width, part.y, part.y + part.height, part.z, part.z + part.depth];
    }
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
    const [left, right] = bayBounds(layout, bay);
    const { height, depth } = sizeOf(layout);
    const base = { id, type, bay };
    switch (type) {
      case 'shelf':
        return { ...base, x1: null, x2: null, y: Math.min(height, 1300), z1: 0, z2: depth };
      case 'rail':
        return { ...base, x1: null, x2: null, y: Math.min(height, 1720), z: Math.min(depth, 300) };
      case 'divider':
        return { ...base, x: left + Math.floor((right - left) / 2), y1: Math.min(1000, height - 1),
          y2: Math.min(1500, height), z1: 0, z2: depth };
      case 'rack': {
        const width = Math.min(180, right - left);
        return { ...base, x: left + Math.floor((right - left - width) / 2), y: Math.min(1030, Math.max(0, height - 240)),
          width, height: Math.min(240, height), z: 0, depth: Math.min(575, depth), travel: Math.min(550, depth + 20) };
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
    if (!inside(x1, left, right) || !inside(x2, x1, right) ||
        (part.type === 'divider' ? x1 <= left || x1 >= right : x1 === x2)) {
      return name + ' must fit within Bay ' + (part.bay + 1) + ' (' + left + '–' + right + ' mm).';
    }
    const height = part.type === 'divider' || part.type === 'rack';
    const [bottom, top] = geometry ? geometry.bounds.slice(2) : [0, cabinetHeight];
    if (!inside(y1, bottom, top) || !inside(y2, y1 + Number(height), top)) {
      return name + ' needs a Y position and height within ' + bottom + '–' + top + ' mm.';
    }
    if (!inside(z1, 0, depth) || !inside(z2, z1 + Number(part.type !== 'rail'), depth)) {
      return name + ' needs a Z position and depth within 0–' + depth + ' mm.';
    }
    if (part.type === 'rack') {
      if (![part.width, part.height, part.depth].every(value => inside(value, 1, Number.MAX_SAFE_INTEGER))) {
        return 'The pull-out sleeve needs a positive width, height and depth.';
      }
      const rack = rackGeometry(part, 1, depth);
      if (!inside(part.travel, 1, depth + 20) || rack.endZ <= rack.startZ) {
        return 'Set travel up to ' + (depth + 20) + ' mm that brings some usable rail past the cabinet front.';
      }
    }
    if (!geometry && layout.notch.enabled && overlap([x1, x2, y1, y2, z1, z2], notchBox(layout.notch, width))) {
      return 'The notch intersects the ' + name.toLowerCase() + ' in Bay ' + (part.bay + 1) + '.';
    }
    if (geometry && !geometry.contains([x1, x2, y1, y2, z1, z2])) {
      return 'The outline intersects the ' + name.toLowerCase() + ' in Bay ' + (part.bay + 1) + '.';
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
    const geometry = hasCustomOutline(layout) ? outlineGeometry(layout) : undefined;
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
    const geometry = hasCustomOutline(source) ? outlineGeometry(source) : undefined;
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
      const [nextA, nextB] = partBounds(layout, layout.parts[i], geometry);
      if (a !== nextA || b !== nextB) changes.push(label);
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
    rackGeometry, makePart, createDocument, validateLayout, parseDocument, sizeOf, outlineGeometry,
    shapeEdits, hasCustomOutline, usableSpan, repartition, validatePart, MIN_BAY };
  if (typeof module === 'object') module.exports = model;
  else window.WardrobeModel = model;
}());
