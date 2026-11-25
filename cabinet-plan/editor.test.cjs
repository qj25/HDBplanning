const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');

test('undo and redo collapse no-ops and replace the redo branch', () => {
  const history = require('./history.js').createHistory();
  assert.equal(history.record({ a: 1 }, { a: 1 }), false);
  history.record({ a: 1 }, { a: 2 });
  assert.deepEqual(history.undo({ a: 2 }), { a: 1 });
  assert.deepEqual(history.redo({ a: 1 }), { a: 2 });
  history.undo({ a: 2 });
  history.record({ a: 1 }, { a: 3 });
  assert.equal(history.canRedo, false);
});

test('custom partitions enforce 100 mm at both ends and in the middle', () => {
  const layout = M.createDocument().layouts[3];
  const empty = { ...layout, parts: [] };
  assert.equal(M.repartition(empty, 18).layout.bays.length, 18);
  assert.match(M.repartition(empty, 19).error, /100 mm/);
  assert.equal(M.validateLayout({ ...empty, dividers: [100, 1721] }), '');
  for (const dividers of [[99, 1721], [100, 199], [100, 1722]]) {
    assert.match(M.validateLayout({ ...empty, dividers }), /100 mm/);
  }
});

test('version 1 narrow partitions migrate and retain existing coordinates', () => {
  const old = M.createDocument();
  old.version = 1;
  old.layouts[3].parts = [];
  old.layouts[3].dividers = [99, 1214];
  const parsed = M.parseDocument(JSON.stringify(old));
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.layouts[3].dividers, [99, 1214]);
  assert.equal(M.validateLayout(parsed.layouts[3]), '');
  assert.match(M.validateLayout({ ...parsed.layouts[3], dividers: [98, 1214] }), /100 mm/);
});

test('rack and short divider translate in XY, preserving the other geometry', () => {
  const { movePart } = require('./movement.js');
  assert.deepEqual(movePart({ type: 'divider', x: 30, y1: 20, y2: 70, z1: 0 }, 5, 8),
    { type: 'divider', x: 35, y1: 28, y2: 78, z1: 0 });
  assert.deepEqual(movePart({ type: 'rack', x: 30, y: 20, travel: 500 }, 0, 8),
    { type: 'rack', x: 30, y: 28, travel: 500 });
});

test('snap respects the allowed axis and uses the nearest valid candidate', () => {
  const { nearestSnap } = require('./movement.js');
  const candidates = [
    { id: 'x-target', axis: 'x', delta: 0 },
    { id: 'too-close-to-fit', axis: 'y', delta: 2 },
    { id: 'second', axis: 'y', delta: 3 },
    { id: 'first', axis: 'y', delta: -3 },
    { id: 'outside', axis: 'y', delta: 15 },
  ];
  const result = nearestSnap(candidates, 'y', 10, candidate => candidate.id !== 'too-close-to-fit');
  assert.equal(result.id, 'first');
  assert.equal(nearestSnap(candidates, 'y', 1, () => true), undefined);
});

test('resizing preserves explicit positions and updates automatic spans and the rack mount', () => {
  const layout = M.createDocument().layouts[3];
  layout.size = { width: 2000, height: 2800, depth: 700 };
  const shelf = layout.parts.find(part => part.type === 'shelf' && part.bay === 2);
  assert.deepEqual(M.partBounds(layout, shelf).slice(0, 2), [1223, 1982]);
  assert.equal(M.rackGeometry(layout.parts.find(part => part.type === 'rack'), 0, layout.size.depth).mountZ, 700);
  assert.equal(M.validateLayout(layout), '');
  layout.size.depth = 500;
  assert.match(M.validateLayout(layout), /within 0–500 mm/);
});

test('outline handles a partial-depth cut, an extension, and both corner types', () => {
  const { build } = require('./outline.js');
  const features = [
    { id: 'cut', kind: 'cut', edge: 'left', at: 0, start: 200, end: 400, offset: 120, z1: 0, z2: 300 },
    { id: 'ext', kind: 'extend', edge: 'right', at: 1000, start: 600, end: 900, offset: 200, z1: 0, z2: 600 },
  ];
  const geometry = build({ width: 1000, height: 1000, depth: 600 }, features, [
    { id: 'r1', x: 0, y: 0, z: 0, radius: 40 },
    { id: 'r2', x: 120, y: 200, z: 0, radius: 30 },
  ]);
  assert.equal(geometry.error, '');
  assert.equal(geometry.bounds[1], 1200);
  assert.equal(geometry.sections[0].corners.filter(corner => corner.radius).length, 2);
  assert.equal(geometry.contains([0, 100, 250, 250, 20, 250]), false);
  assert.equal(geometry.contains([0, 100, 250, 250, 301, 550]), true);
  assert.equal(geometry.contains([0, 15, 0, 0, 20, 250]), false);
  assert.equal(geometry.contains([1000, 1100, 700, 750, 20, 550]), true);
});

test('outline rejects attached cuts that split the shell and radii that overrun an edge', () => {
  const { build } = require('./outline.js');
  const size = { width: 1000, height: 1000, depth: 600 };
  const cut = { kind: 'cut', edge: 'left', at: 0, start: 300, end: 600, offset: 1000, z1: 0, z2: 600 };
  assert.match(build(size, [cut]).error, /split/);
  assert.match(build(size, [], [
    { x: 0, y: 0, z: 0, radius: 600 },
    { x: 1000, y: 0, z: 0, radius: 600 },
  ]).error, /adjacent/);
});


test('full drawings use direct dimensions in all three views and show side bays separately', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { runInNewContext } = require('node:vm');
  const window = { WardrobeModel: M, WardrobeOutline: require('./outline.js') };
  runInNewContext(readFileSync(join(__dirname, 'drawing.js'), 'utf8'), { window });
  const drawing = window.WardrobeDrawing;
  const layout = M.createDocument().layouts[3];
  const drawer = M.makePart(layout, 'drawer', 0, 'drawer-check');
  layout.parts.push(drawer);
  layout.notch.enabled = true;
  for (const view of ['front', 'side', 'iso']) {
    const basic = drawing.render(layout, { view, side: 'left' });
    const full = drawing.render(layout, { view, side: 'left', full: true, selected: drawer.id });
    assert.ok(full.split('dimension-label').length > basic.split('dimension-label').length);
    assert.doesNotMatch(full, /NaN|Infinity|measure-dot|measure-number/);
    assert.match(full, /class="dimension extension"/);
    if (view !== 'iso') assert.match(full, /data-drag="resize-/);
  }
  const left = drawing.render(layout, { view: 'side', side: 'left', full: true, travel: { [drawer.id]: 0.5 } });
  const right = drawing.render(layout, { view: 'side', side: 'right', full: true });
  const bays = left.split('class="side-bay"').slice(1);
  assert.equal(bays.length, 3);
  assert.match(bays[0], /drawer-check/);
  assert.ok(bays.slice(1).every(bay => !bay.includes('drawer-check')));
  assert.match(bays[0], /notch-face/);
  assert.ok(bays.slice(1).every(bay => !bay.includes('notch-face')));
  assert.notEqual(left, right);
  const a = drawing.frame(layout, { view: 'side', side: 'left' }).project([0, 100, 100]);
  const b = drawing.frame(layout, { view: 'side', side: 'right' }).project([0, 100, 100]);
  assert.equal(a[0] + b[0], drawing.SIDE_WIDTH);
  assert.equal(a[1], b[1]);
});

test('many side elevations can be rendered in print rows while keeping scale and ordering', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { runInNewContext } = require('node:vm');
  const window = { WardrobeModel: M, WardrobeOutline: require('./outline.js') };
  runInNewContext(readFileSync(join(__dirname, 'drawing.js'), 'utf8'), { window });
  const source = { ...M.createDocument().layouts[3], parts: [] };
  const { layout } = M.repartition(source, 18);
  const options = { view: 'side', side: 'right', full: true, interactive: false };
  const all = window.WardrobeDrawing.render(layout, options);
  const row = window.WardrobeDrawing.render(layout, { ...options, sideBays: [15, 16, 17] });
  assert.equal((all.match(/data-side-bay=/g) ?? []).length, 18);
  assert.equal((row.match(/data-side-bay=/g) ?? []).length, 3);
  assert.match(row, /data-side-bay="15" transform="translate\(0 0\)"/);
  assert.match(row, /data-side-bay="17" transform="translate\(720 0\)"/);
  assert.doesNotMatch(row, /data-drag=/);
});
