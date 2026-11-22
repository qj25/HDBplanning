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
  assert.deepEqual(partBounds(layout, part).slice(0, 2), [0, 650]);
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
