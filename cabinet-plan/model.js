(function () {
  'use strict';

  const W = 1821;
  const H = 2600;
  const D = 600;
  const TYPES = { shelf: 'Shelf', divider: 'Short divider', rail: 'Clothes rail', rack: 'Pull-out rack' };
  const OWNERS = { none: 'Unassigned', first: 'Person 1', second: 'Person 2', shared: 'Shared' };
  const DEFAULT_NOTCH = { enabled: false, side: 'left', y: 600, height: 300, width: 300, depth: 350 };
  const inside = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
  const overlap = (a, b) => [0, 2, 4].every(i => a[i] < b[i + 1] && b[i] < a[i + 1]);

  function bayBounds(layout, bay) {
    return [layout.dividers[bay - 1] ?? 0, layout.dividers[bay] ?? W];
  }

  function notchBox({ side, y, height, width, depth }) {
    const [x1, x2] = side === 'left' ? [0, width] : [W - width, W];
    return [x1, x2, y, y + height, 0, depth];
  }

  function partBounds(layout, part) {
    const [left, right] = bayBounds(layout, part.bay);
    switch (part.type) {
      case 'shelf':
        return [part.x1 ?? left, part.x2 ?? right, part.y, part.y, part.z1, part.z2];
      case 'rail':
        return [part.x1 ?? left, part.x2 ?? right, part.y, part.y, part.z, part.z];
      case 'divider':
        return [part.x, part.x, part.y1, part.y2, part.z1, part.z2];
      case 'rack':
        return [part.x, part.x + part.width, part.y, part.y + part.height, part.z, part.z + part.depth];
    }
  }

  function rackGeometry(part, fraction) {
    const [front, back] = [part.z, part.z + part.depth];
    const inset = Math.min(35, part.depth / 5);
    const stowedStart = front + inset;
    const stowedEnd = Math.min(back - inset, part.travel - 20);
    return {
      x: part.x + part.width / 2, y: part.y + part.height * 0.74,
      mountZ: D, sleeveBack: back,
      startZ: stowedStart - part.travel * fraction,
      endZ: stowedEnd - part.travel * fraction,
    };
  }

  function makePart(layout, type, bay, id) {
    const [left, right] = bayBounds(layout, bay);
    const base = { id, type, bay };
    switch (type) {
      case 'shelf':
        return { ...base, x1: null, x2: null, y: 1300, z1: 0, z2: 600 };
      case 'rail':
        return { ...base, x1: null, x2: null, y: 1720, z: 300 };
      case 'divider':
        return { ...base, x: left + Math.floor((right - left) / 2), y1: 1000, y2: 1500, z1: 0, z2: 600 };
      case 'rack': {
        const width = Math.min(180, right - left);
        return { ...base, x: left + Math.floor((right - left - width) / 2), y: 1030,
          width, height: 240, z: 0, depth: 575, travel: 550 };
      }
    }
  }

  function createLayout(count) {
    const layout = {
      dividers: count === 3 ? [607, 1214] : [455, 910, 1366],
      bays: Array.from({ length: count }, () => ({ name: '', owner: 'none' })),
      parts: [],
      notch: { ...DEFAULT_NOTCH },
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
    return { version: 1, active: 3, layouts: { 3: createLayout(3), 4: createLayout(4) } };
  }

  function validateNotch(layout) {
    const notch = layout.notch;
    if (!notch || typeof notch.enabled !== 'boolean' || !['left', 'right'].includes(notch.side)) {
      return 'The side notch needs a valid side and on/off setting.';
    }
    if (!inside(notch.width, 1, W)) return 'Set the notch width between 1 and 1821 mm.';
    if (!inside(notch.depth, 1, D)) return 'Set the notch depth between 1 and 600 mm.';
    if (!inside(notch.y, 1, H - 2) || !inside(notch.height, 1, H - 1 - notch.y)) {
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

  function validatePart(layout, part) {
    const name = TYPES[part.type];
    const [left, right] = bayBounds(layout, part.bay);
    const [x1, x2, y1, y2, z1, z2] = partBounds(layout, part);
    const spanning = part.type === 'shelf' || part.type === 'rail';
    if (spanning && ![part.x1, part.x2].every(x => x === null || Number.isInteger(x))) {
      return name + ' needs whole-millimetre X coordinates or bay-edge anchors.';
    }
    if (!inside(x1, left, right) || !inside(x2, x1, right) ||
        (part.type === 'divider' ? x1 <= left || x1 >= right : x1 === x2)) {
      return name + ' must fit within Bay ' + (part.bay + 1) + ' (' + left + '–' + right + ' mm).';
    }
    const height = part.type === 'divider' || part.type === 'rack';
    if (!inside(y1, 0, H) || !inside(y2, y1 + Number(height), H)) {
      return name + ' needs a Y position and height within 0–2600 mm.';
    }
    if (!inside(z1, 0, D) || !inside(z2, z1 + Number(part.type !== 'rail'), D)) {
      return name + ' needs a Z position and depth within 0–600 mm.';
    }
    if (part.type === 'rack') {
      if (![part.width, part.height, part.depth].every(value => inside(value, 1, H))) {
        return 'The pull-out sleeve needs a positive width, height and depth.';
      }
      const geometry = rackGeometry(part, 1);
      if (!inside(part.travel, 1, D + 20) || geometry.endZ <= geometry.startZ) {
        return 'Set a travel distance up to 620 mm that brings some usable rail past the cabinet front.';
      }
    }
    if (layout.notch.enabled && overlap([x1, x2, y1, y2, z1, z2], notchBox(layout.notch))) {
      return 'The notch intersects the ' + name.toLowerCase() + ' in Bay ' + (part.bay + 1) + '.';
    }
    return '';
  }

  function validateLayout(layout, count = layout?.bays?.length) {
    if (!layout || ![3, 4].includes(count) || !Array.isArray(layout.bays) ||
        layout.bays.length !== count || !Array.isArray(layout.dividers) ||
        layout.dividers.length !== count - 1 || !Array.isArray(layout.parts)) {
      return 'The layout needs a complete three- or four-column template.';
    }
    for (const [index, x] of layout.dividers.entries()) {
      if (!inside(x, (layout.dividers[index - 1] ?? 0) + 1, W - 1)) {
        return 'Keep main dividers in order and leave at least 1 mm in each bay.';
      }
    }
    for (const bay of layout.bays) {
      if (!bay || typeof bay.name !== 'string' || bay.name.length > 40 ||
          !Object.hasOwn(OWNERS, bay.owner)) return 'Each bay needs a valid name and assignment.';
    }
    const notchError = validateNotch(layout);
    if (notchError) return notchError;
    const ids = new Set();
    for (const part of layout.parts) {
      if (!part || !Object.hasOwn(TYPES, part.type) || !inside(part.bay, 0, count - 1) ||
          typeof part.id !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(part.id) ||
          /^(notch|(?:bay|main)-\d+)$/.test(part.id) || ids.has(part.id)) {
        return 'The layout contains an invalid or duplicate part.';
      }
      ids.add(part.id);
      const error = validatePart(layout, part);
      if (error) return error;
    }
    return '';
  }

  function parseDocument(text) {
    const document = JSON.parse(text);
    if (document?.version !== 1) throw new Error('This file does not use wardrobe plan version 1.');
    if (![3, 4].includes(document.active)) throw new Error('Choose a valid active layout.');
    for (const count of [3, 4]) {
      const error = validateLayout(document.layouts?.[count], count);
      if (error) throw new Error(count + '-column layout: ' + error);
    }
    return document;
  }

  const model = { W, H, D, TYPES, OWNERS, bayBounds, notchBox, partBounds,
    rackGeometry, makePart, createDocument, validateLayout, parseDocument };
  if (typeof module === 'object') module.exports = model;
  else window.WardrobeModel = model;
}());
