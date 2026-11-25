const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('./model.js');
const { createDocument, bayBounds, notchBox, rackGeometry, validateLayout, parseDocument, partBounds } = model;

test('presets have the specified widths, separate edits and valid geometry', () => {
  const { layouts } = createDocument();
  assert.deepEqual(layouts[3].dividers, [607, 1214]);
  assert.deepEqual(layouts[4].dividers, [455, 910, 1366]);
  for (const layout of Object.values(layouts)) {
    assert.equal(validateLayout(layout), '');
    assert.equal(bayBounds(layout, 0)[0], 0);
    assert.equal(bayBounds(layout, layout.bays.length - 1)[1], 1821);
  }
  layouts[3].bays[0].name = 'Linen';
  assert.equal(layouts[4].bays[0].name, '');
});

test('left and right notches mirror, allow full depth and enforce the outer bay', () => {
  const layout = createDocument().layouts[4];
  layout.notch.enabled = true;
  assert.deepEqual(notchBox(layout.notch), [0, 300, 600, 900, 0, 350]);
  assert.equal(validateLayout(layout), '');
  Object.assign(layout.notch, { side: 'right', depth: 600 });
  assert.deepEqual(notchBox(layout.notch), [1521, 1821, 600, 900, 0, 600]);
  assert.equal(validateLayout(layout), '');
  layout.notch.width = 456;
  assert.match(validateLayout(layout), /outer bay/i);
});

test('boundary contact is allowed, occupied notch volume is rejected, and Z matters', () => {
  const layout = createDocument().layouts[3];
  layout.notch.enabled = true;
  delete layout.thickness; // A stored layout from before board thickness was added.
  const shelf = { id: 'edge', type: 'shelf', bay: 0, x1: null, x2: null, y: 600, z1: 0, z2: 600 };
  layout.parts.push(shelf);
  assert.equal(validateLayout(layout), '');
  shelf.y = 700;
  assert.match(validateLayout(layout), /notch.*shelf/i);
  shelf.z1 = 350;
  assert.equal(validateLayout(layout), '');
  shelf.z1 = 349;
  assert.match(validateLayout(layout), /notch.*shelf/i);
});

test('automatic spans follow bay changes, custom spans constrain divider movement', () => {
  const layout = createDocument().layouts[3];
  const part = layout.parts.find(p => p.bay === 0 && p.type === 'shelf');
  layout.dividers[0] = 650;
  assert.deepEqual(partBounds(layout, part).slice(0, 2), [18, 641]);
  part.x2 = 630;
  layout.dividers[0] = 610;
  assert.match(validateLayout(layout), /shelf.*bay 1/i);
});

test('rack travel leaves its mounting point fixed and brings the entire usable segment forward', () => {
  const layout = createDocument().layouts[3];
  const rack = layout.parts.find(p => p.type === 'rack');
  const parked = rackGeometry(rack, 0);
  const extended = rackGeometry(rack, 1);
  assert.equal(parked.mountZ, 600);
  assert.equal(extended.mountZ, parked.mountZ);
  assert.ok(parked.endZ > parked.startZ);
  assert.ok(extended.endZ < 0);
  assert.equal(parked.endZ - extended.endZ, rack.travel);
});

test('import round trips both templates and rejects malformed stored geometry', () => {
  const document = createDocument();
  document.layouts[4].notch.enabled = true;
  document.active = 4;
  assert.deepEqual(parseDocument(JSON.stringify(document)), document);
  document.layouts[4].notch.depth = 601;
  assert.throws(() => parseDocument(JSON.stringify(document)), /depth/i);
  assert.throws(() => parseDocument('{"version":2}'), /version/i);
  assert.throws(() => parseDocument('{"version":1,"active":3,"layouts":{"3":null}}'), /layout/i);
});

test('import rejects part IDs reserved for built-in drawing selections', () => {
  const document = createDocument();
  for (const id of ['notch', 'bay-0', 'main-0']) {
    document.layouts[3].parts[0].id = id;
    assert.throws(() => parseDocument(JSON.stringify(document)), /invalid or duplicate part/i);
  }
});


test('thickness stays inside the outside profile and accounts for cut-ins and extensions', () => {
  const layout = createDocument().layouts[3];
  const shelf = layout.parts.find(p => p.type === 'shelf' && p.bay === 0);
  shelf.y = 720;
  layout.features = [
    { id: 'cut', kind: 'cut', edge: 'left', at: 0, start: 600, end: 900, offset: 300, z1: 0, z2: 350 },
    { id: 'extended', kind: 'extend', edge: 'right', at: 1821, start: 600, end: 900, offset: 100, z1: 0, z2: 600 },
  ];
  assert.equal(validateLayout(layout), '');
  const envelope = model.outlineGeometry(layout).bounds;
  assert.deepEqual(partBounds(layout, shelf), [318, 598, 711, 729, 0, 600]);
  Object.assign(layout.thickness, { edge: 25, internal: 20 });
  assert.deepEqual(model.outlineGeometry(layout).bounds, envelope);
  assert.deepEqual(partBounds(layout, shelf), [325, 597, 710, 730, 0, 600]);

  shelf.y = 20;
  assert.match(validateLayout(layout), /position and height/i);
});

test('older v2 files retain thin panels and unchanged spans across export and import', () => {
  const document = createDocument();
  for (const layout of Object.values(document.layouts)) delete layout.thickness;
  const original = JSON.stringify(document);
  const roundTrip = parseDocument(original);
  assert.equal(JSON.stringify(roundTrip), original);
  const first = roundTrip.layouts[3];
  assert.deepEqual(partBounds(first, first.parts[0]), [0, 607, 2110, 2110, 0, 600]);
  assert.deepEqual(model.thicknessOf(first), { internal: 0, edge: 0 });
  const derived = model.repartition(first, 3, true);
  assert.deepEqual(derived.layout.thickness, { internal: 18, edge: 18 });
  assert.equal(first.thickness, undefined);
  derived.layout.thickness.internal = 19;
  assert.equal(partBounds(derived.layout, derived.layout.parts[0])[1], 597.5);
});

test('rails stay attached to a divider across edits and export, and detach if it is removed', () => {
  const document = createDocument();
  const layout = document.layouts[3];
  const rail = layout.parts.find(p => p.type === 'rail' && p.bay === 0);
  layout.parts.push({ ...model.makePart(layout, 'divider', 0, 'support'), x: 395, y2: rail.y + 100 });
  rail.x2Anchor = 'support';
  assert.equal(validateLayout(layout), '');
  assert.equal(partBounds(layout, rail)[1], 386);
  const restored = parseDocument(JSON.stringify(document)).layouts[3];
  const attached = restored.parts.find(p => p.id === rail.id);
  restored.parts.find(p => p.id === 'support').x += 50;
  assert.equal(partBounds(restored, attached)[1], 436);
  const previous = structuredClone(restored);
  restored.parts = restored.parts.filter(p => p.id !== 'support');
  model.releaseRailAnchors(restored, previous);
  assert.equal(attached.x2Anchor, undefined);
  assert.equal(partBounds(restored, attached)[1], 436);
  assert.equal(validateLayout(restored), '');
  attached.x2Anchor = 'main-0';
  restored.dividers[0] += 10;
  assert.equal(partBounds(restored, attached)[1], 608);
});

test('the drawer saves closed geometry and projects the configured travel', () => {
  const document = createDocument();
  const layout = document.layouts[3];
  const drawer = model.makePart(layout, 'drawer', 0, 'first-drawer');
  layout.parts.push(drawer);
  const restored = parseDocument(JSON.stringify(document)).layouts[3];
  const closed = model.drawerBounds(restored, drawer, 0);
  const extended = model.drawerBounds(restored, drawer, 1);
  assert.deepEqual(extended.slice(0, 4), closed.slice(0, 4));
  assert.deepEqual(extended.slice(4), closed.slice(4).map(z => z - drawer.travel));
  drawer.height = 18;
  assert.match(validateLayout(layout), /enough space for its boards/i);
});
