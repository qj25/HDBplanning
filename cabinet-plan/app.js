(function () {
  'use strict';

  const M = window.WardrobeModel;
  const Drawing = window.WardrobeDrawing;
  const Move = window.WardrobeMovement;
  const Outline = window.WardrobeOutline;
  const history = window.WardrobeHistory.createHistory();
  const $ = id => document.getElementById(id);
  const drawing = $('drawing');
  const storageKey = 'wardrobe-planner-v1';
  const viewNames = { front: 'Front elevation', side: 'Side elevation', iso: 'Isometric' };
  const ui = { view: 'front', side: 'left', selected: 'bay-0', bay: 0, travel: Object.create(null),
    full: false, snap: false };
  let plan = M.createDocument();
  let storageAvailable = true;
  let drag = null;
  let pendingImport = 0;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        plan = M.parseDocument(saved);
      } catch {
        message('The browser draft could not be opened. A fresh template is shown.', true);
      }
    }
  } catch {
    storageAvailable = false;
  }

  const current = () => drag?.preview ?? plan.layouts[plan.active];
  const esc = value => String(value).replace(/[&<>"']/g, match =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[match]);

  function save() {
    if (!storageAvailable) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(plan));
    } catch {
      storageAvailable = false;
      message('Browser draft saving is unavailable. Use Export JSON to save the plan.', true);
    }
  }

  function message(text = '', error = false) {
    const status = $('status');
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle('error', error);
  }

  function commit(layout, feedback = '') {
    const error = M.validateLayout(layout);
    if (error) {
      message(error, true);
      return false;
    }
    commitDocument({ ...plan, layouts: { ...plan.layouts, [plan.active]: layout } }, feedback);
    return true;
  }

  function commitDocument(next, feedback = '') {
    if (history.record(plan, next)) {
      plan = next;
      save();
    }
    if (feedback) message(feedback);
    else if (storageAvailable) message();
    renderHistory();
  }

  function renderHistory() {
    $('undo').disabled = !history.canUndo;
    $('redo').disabled = !history.canRedo;
  }

  function restore(action) {
    if (drag) cancelDrag();
    const restored = history[action](plan);
    if (restored === plan) return;
    plan = restored;
    ui.preview = null;
    const layout = current();
    const target = selection();
    if (target.kind === 'part' && !target.part || target.kind === 'bay' && !layout.bays[target.index] ||
        target.kind === 'main' && layout.dividers[target.index] === undefined ||
        target.kind === 'feature' && !target.feature || target.kind === 'radius' && !target.radius) {
      ui.selected = 'bay-0';
    }
    ui.bay = selection().part?.bay ?? Math.min(ui.bay, layout.bays.length - 1);
    ui.travel = Object.create(null);
    message(action === 'undo' ? 'Edit undone.' : 'Edit redone.');
    save();
    render();
  }

  function selection() {
    const id = ui.selected;
    const match = /^(bay|main)-(\d+)$/.exec(id);
    if (match) return { kind: match[1], index: Number(match[2]) };
    if (id === 'notch') return { kind: 'notch' };
    if (['cabinet', 'columns', 'outline', 'outline-new', 'radius-new'].includes(id)) return { kind: id };
    if (id.startsWith('dim-')) return { kind: 'callout', key: id.slice(4) };
    if (id.startsWith('outline-')) {
      return { kind: 'feature', feature: current().features?.find(item => 'outline-' + item.id === id) };
    }
    if (id.startsWith('radius-')) {
      return { kind: 'radius', radius: current().radii?.find(item => 'radius-' + item.id === id) };
    }
    return { kind: 'part', part: current().parts.find(item => item.id === id) };
  }

  function choose(id) {
    if (drag) cancelDrag();
    ui.preview = null;
    ui.selected = id;
    const target = selection();
    if (target.kind === 'bay') ui.bay = target.index;
    if (target.kind === 'part' && target.part) ui.bay = target.part.bay;
    if (target.kind === 'notch' && ui.view === 'side') ui.side = current().notch.side;
    message();
    render();
  }

  function numberField(name, caption, value, placeholder = '') {
    return '<div class="field"><label for="field-' + name + '">' + caption + '</label>' +
      '<input type="number" step="1" name="' + name + '" id="field-' + name + '" value="' +
      (value ?? '') + '" placeholder="' + esc(placeholder) + '"' + (placeholder ? '' : ' required') + '></div>';
  }

  function selectField(name, caption, options, selected, wide = false) {
    return '<div class="field' + (wide ? ' wide' : '') + '"><label for="field-' + name + '">' + caption +
      '</label><select name="' + name + '" id="field-' + name + '">' + Object.entries(options).map(([id, text]) =>
      '<option value="' + esc(id) + '"' + (String(selected) === id ? ' selected' : '') + '>' +
      esc(text) + '</option>').join('') + '</select></div>';
  }

  function boxField(name, caption, checked) {
    return '<div class="field wide"><label class="check"><input type="checkbox" name="' +
      name + '"' + (checked ? ' checked' : '') + '> ' + caption + '</label></div>';
  }

  function inspector(title, subtitle, fields, note = '', part = false) {
    return '<div class="inspector-header"><h2>' + esc(title) + '</h2>' +
      (subtitle ? '<p>' + esc(subtitle) + '</p>' : '') + '</div>' +
      '<form id="edit-form"><div class="fields">' + fields + '</div>' +
      (note ? '<p class="field-note">' + esc(note) + '</p>' : '') +
      '<div class="inspector-actions"><button class="primary" type="submit">Apply</button>' +
      (part ? '<button class="danger" type="button" data-remove>Remove part</button>' : '') +
      '</div></form>';
  }

  function partInspector(part) {
    const bayOptions = Object.fromEntries(current().bays.map((bay, i) => [i, bay.name || 'Bay ' + (i + 1)]));
    const num = (name, caption, placeholder) => numberField(name, caption, part[name], placeholder);
    let fields = selectField('bay', 'Bay', bayOptions, part.bay, true);
    let note = '';
    if (part.type === 'rack') {
      const fraction = ui.travel[part.id] ?? 0;
      const distance = Math.round(fraction * part.travel);
      fields += num('x', 'Left edge X') + num('y', 'Bottom edge Y') + num('z', 'Front edge Z') +
        num('width', 'Width') + num('height', 'Height') + num('depth', 'Sleeve depth') +
        num('travel', 'Maximum travel') +
        '<div class="field wide"><label for="pull-travel">Pull out · <output id="travel-value" for="pull-travel">' +
        distance + ' mm</output></label><input id="pull-travel" type="range" min="0" max="' + part.travel +
        '" value="' + distance + '"></div>';
      note = 'See the rail travel in Side or Isometric view. The mount stays at Z = ' + M.sizeOf(current()).depth + ' mm.';
    } else if (part.type === 'divider') {
      fields += num('x', 'X') + num('y1', 'Bottom Y') + num('y2', 'Top Y') +
        num('z1', 'Front Z') + num('z2', 'Back Z');
    } else {
      const [left, right] = M.partBounds(current(), { ...part, x1: null, x2: null });
      fields += num('x1', 'Start X', String(left) + ' (bay edge)') +
        num('x2', 'End X', String(right) + ' (bay edge)') + num('y', 'Height Y');
      fields += part.type === 'shelf' ? num('z1', 'Front Z') + num('z2', 'Back Z') : num('z', 'Depth Z');
      note = 'Leave an X endpoint blank to follow that bay edge.';
    }
    return inspector(M.TYPES[part.type], 'Positions and dimensions in mm', fields, note, true);
  }

  function renderInspector() {
    const { kind, index, part, feature, radius, key } = selection();
    const layout = current();
    const size = M.sizeOf(layout);
    let markup;
    if (kind === 'bay') {
      const [left, right] = M.bayBounds(layout, index);
      const bay = layout.bays[index];
      markup = inspector('Bay ' + (index + 1), (right - left) + ' mm wide · X ' + left + '–' + right,
        '<div class="field wide"><label for="bay-name">Name</label><input id="bay-name" name="name" ' +
        'maxlength="40" value="' + esc(bay.name) + '" placeholder="e.g. Everyday clothes"></div>' +
        selectField('owner', 'Assigned to', M.OWNERS, bay.owner, true));
    } else if (kind === 'main') {
      markup = inspector('Main divider ' + (index + 1), 'Full height and depth',
        numberField('x', 'Position X (mm)', layout.dividers[index]));
    } else if (kind === 'notch') {
      const n = layout.notch;
      markup = inspector('Side notch', 'Open from the front and selected side',
        boxField('enabled', 'Enable notch', n.enabled) + selectField('side', 'Side from front',
          { left: 'Left', right: 'Right' }, n.side, true) +
        numberField('y', 'Surface Y', n.y) + numberField('height', 'Opening height', n.height) +
        numberField('width', 'Width in from side', n.width) + numberField('depth', 'Depth from front', n.depth),
        'All values are in mm. Use the surface height to line up with the bed.');
    } else if (kind === 'cabinet') {
      markup = inspector('Cabinet dimensions', 'Nominal size in mm',
        numberField('width', 'Width', size.width) + numberField('height', 'Height', size.height) +
        numberField('depth', 'Depth', size.depth));
    } else if (kind === 'callout') {
      markup = inspector('Dimension callout', key.replace('-', ' '),
        numberField('offset', 'Drawing offset', layout.callouts?.[key] ?? Drawing.callouts[key]) +
        '<button type="button" data-action="reset-callout">Reset position</button>');
    } else if (kind === 'columns') {
      const count = layout.bays.length;
      const max = Math.floor(size.width / M.MIN_BAY);
      const widths = layout.bays.map((_, i) => {
        const [a, b] = M.bayBounds(layout, i);
        return b - a;
      });
      markup = inspector('Custom columns', '1–' + max + ' columns at this width',
        numberField('count', 'Column count', count) +
        '<div class="field"><label for="layout-name">Layout name</label><input id="layout-name" name="layoutName" ' +
        'maxlength="40" value="' + esc(layout.name || 'Custom ' + count) + '"></div>' +
        '<div class="field wide"><label for="column-positions">Divider X positions (optional)</label>' +
        '<input id="column-positions" name="positions" placeholder="' + esc(layout.dividers.join(', ')) + '"></div>' +
        boxField('accept', 'Accept changes to automatic shelf and rail spans', false) +
        '<button type="button" data-action="preview-columns">Preview columns</button>',
        'Leave positions empty for equal widths. Current widths are ' + widths.join(', ') + ' mm.' +
        (widths.some(width => width < 100) ? ' This imported layout has a column under 100 mm.' : ''));
    } else if (kind === 'outline') {
      markup = '<div class="inspector-header"><h2>Outline</h2><p>Add or select a cut, extension, or radius.</p></div>' +
        '<div class="inspector-actions"><button type="button" data-action="cut">Cut in</button>' +
        '<button type="button" data-action="extend">Extend out</button>' +
        '<button type="button" data-action="round">Round corner</button></div>';
    } else if (kind === 'feature' || kind === 'outline-new') {
      const item = feature ?? ui.outlineDraft;
      const edits = M.shapeEdits(layout);
      const existing = feature ? edits.slice(0, edits.findIndex(edit => edit.id === feature.id)) : edits;
      const outline = Outline.build(size, existing);
      const edgeChoices = (outline.sections ?? []).flatMap(section => section.points.map((a, i) => {
        const b = section.points[(i + 1) % section.points.length];
        const vertical = a[0] === b[0];
        const edge = vertical ? (b[1] > a[1] ? 'right' : 'left') : (b[0] > a[0] ? 'bottom' : 'top');
        const [start, end] = (vertical ? [a[1], b[1]] : [a[0], b[0]]).sort((x, y) => x - y);
        const at = vertical ? a[0] : a[1];
        return [[edge, at, start, end, section.z1, section.z2].join(','),
          edge[0].toUpperCase() + edge.slice(1) + ' · ' + (vertical ? 'X ' : 'Y ') + at + ' · ' + start +
          '–' + end + ' · Z ' + section.z1 + '–' + section.z2];
      }));
      markup = inspector(item.kind === 'cut' ? 'Cut in' : 'Extend out', 'All measurements in mm',
        selectField('edge-template', 'Use an exposed edge', Object.fromEntries([['', 'Choose an edge'], ...edgeChoices]), '', true) +
        selectField('edge', 'Edge faces', { left: 'Left', right: 'Right', top: 'Up', bottom: 'Down' }, item.edge, true) +
        numberField('at', 'Edge coordinate', item.at) + numberField('offset', 'Offset from edge', item.offset) +
        numberField('start', 'Span start', item.start) + numberField('end', 'Span end', item.end) +
        numberField('z1', 'Front Z', item.z1) + numberField('z2', 'Back Z', item.z2) +
        '<button type="button" data-action="preview-outline">Preview</button>' +
        (feature ? '<button type="button" data-action="remove-outline">Remove feature</button>' : ''),
        'On a left or right edge, enter X for the edge and Y for the span. On a top or bottom edge, enter Y for the edge and X for the span.');
    } else if (kind === 'radius' || kind === 'radius-new') {
      const item = radius ?? ui.outlineDraft;
      const outline = M.outlineGeometry(layout);
      const choices = outline.sections.flatMap(section => section.corners.map(corner => {
        const [x, y] = corner.point;
        return [x + ',' + y + ',' + section.z1,
          (corner.sweep < 0 ? 'Inside' : 'Outside') + ' · X ' + x + ' · Y ' + y + ' · Z ' + section.z1];
      }));
      const selected = choices.find(([id]) => id.startsWith(item.x + ',' + item.y + ',') &&
        Number(id.split(',')[2]) === outline.sections.find(section => item.z >= section.z1 && item.z < section.z2)?.z1)?.[0];
      markup = inspector('Round corner', 'Inside and outside corners',
        selectField('corner', 'Corner', Object.fromEntries(choices), selected, true) +
        numberField('radius', 'Radius (mm)', item.radius) +
        '<button type="button" data-action="preview-outline">Preview</button>' +
        (radius ? '<button type="button" data-action="remove-outline">Remove radius</button>' : ''),
        'Set the radius to zero for a square corner.');
    } else {
      markup = partInspector(part);
    }
    $('inspector').innerHTML = markup;
  }

  function row(id, title, detail) {
    return '<button type="button" class="row-button" data-row="' + esc(id) + '" aria-pressed="' +
      (ui.selected === id) + '"><span title="' + esc(title) + '">' + esc(title) + '</span><small>' +
      esc(detail) + '</small></button>';
  }

  function renderLists() {
    const layout = current();
    const openBays = new Set([...$('parts').querySelectorAll('details[open]')].map(el => el.dataset.group));
    $('bays').innerHTML = layout.bays.map((bay, i) =>
      row('bay-' + i, bay.name || 'Bay ' + (i + 1), M.OWNERS[bay.owner])).join('');
    const fixtures = layout.dividers.map((x, index) =>
      row('main-' + index, 'Main divider ' + (index + 1), 'X ' + x)).join('') +
      row('notch', 'Side notch', layout.notch.enabled ? layout.notch.side : 'Off') +
      (layout.features ?? []).map((feature, index) => row('outline-' + feature.id,
        (feature.kind === 'cut' ? 'Cut in ' : 'Extension ') + (index + 1), feature.offset + ' mm')).join('') +
      (layout.radii ?? []).map(radius => row('radius-' + radius.id, 'Corner radius', 'R' + radius.radius)).join('');
    $('parts').innerHTML = fixtures + layout.bays.map((bay, i) => {
      const parts = layout.parts.filter(part => part.bay === i);
      if (!parts.length) return '';
      const open = i === ui.bay || openBays.has(String(i));
      return '<details data-group="' + i + '"' + (open ? ' open' : '') + '><summary>' +
        esc(bay.name || 'Bay ' + (i + 1)) + ' parts</summary><div>' +
        parts.map(part => row(part.id, M.TYPES[part.type],
          part.type === 'divider' ? 'X ' + part.x : 'Y ' + part.y)).join('') + '</div></details>';
    }).join('');
    const labels = Object.entries(plan.layouts).map(([id, item]) =>
      [id, item.name || item.bays.length + ' columns']);
    const buttons = [...$('layouts').querySelectorAll('button')];
    if (labels.length !== buttons.length || labels.some(([id, name], i) =>
      buttons[i].dataset.layout !== id || buttons[i].textContent !== name)) {
      $('layouts').innerHTML = labels.map(([id, name]) => '<button type="button" data-layout="' + esc(id) +
        '">' + esc(name) + '</button>').join('');
    }
    for (const button of $('layouts').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', button.dataset.layout === String(plan.active));
    }
    const { width, height, depth } = M.sizeOf(layout);
    $('cabinet-summary').textContent = width + ' W × ' + height + ' H × ' + depth + ' D mm';
    $('add-type').previousElementSibling.textContent = 'Add to ' + (layout.bays[ui.bay].name || 'Bay ' + (ui.bay + 1));
  }

  function renderDrawing() {
    const layout = drag?.preview ?? ui.preview ?? current();
    drawing.innerHTML = Drawing.render(layout, { ...ui, projection: drag?.frame, guide: drag?.guide });
    drawing.setAttribute('aria-label', viewNames[ui.view] + ', ' + layout.bays.length + '-column wardrobe');
    drawing.setAttribute('viewBox', drag?.viewBox ?? drawingViewBox(layout, ui.view));
    $('measurement-details').hidden = !ui.full || ui.view === 'iso';
    if (ui.full && ui.view !== 'iso') $('measurement-details').innerHTML = measurementTable(layout, ui.view);
  }

  function drawingViewBox(layout, view) {
    const offsets = layout.callouts ?? {};
    const used = view === 'front' ? ['front-width', 'front-height'] : view === 'side' ? ['side-depth', 'side-height'] : [];
    const largest = Math.max(0, ...used.map(id => Math.abs(offsets[id] ?? 0)));
    const padding = Math.max(0, largest - 40);
    return [-padding, -padding, 720 + padding * 2, 630 + padding * 2].join(' ');
  }

  function measurementTable(layout, view) {
    const records = Drawing.measurementRecords(layout, view);
    if (!records.length) return '';
    return '<table class="measurements"><caption>Feature dimensions (mm)</caption><thead><tr><th scope="col">#</th>' +
      '<th scope="col">Feature</th><th scope="col">Measurements</th></tr></thead><tbody>' +
      records.map((record, i) => '<tr><td>' + (i + 1) + '</td><th scope="row">' + esc(record.title) +
        '</th><td>' + esc(record.value) + '</td></tr>').join('') + '</tbody></table>';
  }

  function render() {
    renderHistory();
    renderLists();
    renderInspector();
    renderView();
  }

  function renderView() {
    renderDrawing();
    for (const button of $('views').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', button.dataset.view === ui.view);
    }
    $('side-control').hidden = ui.view !== 'side';
    $('side-view').value = ui.side;
    $('drawing-hint').textContent = {
      front: 'Drag a part or set its exact position in the inspector.',
      side: 'Use the pull-out rack inspector to see the rail travel.',
      iso: 'Select a part to see its position and dimensions.',
    }[ui.view];
  }

  function outlineEdit(layout, data, target) {
    const numeric = name => Number(data.get(name));
    if (target.kind === 'feature' || target.kind === 'outline-new') {
      const feature = { ...(target.feature ?? ui.outlineDraft), edge: data.get('edge') };
      for (const field of ['at', 'offset', 'start', 'end', 'z1', 'z2']) feature[field] = numeric(field);
      layout.features = [...(layout.features ?? [])];
      const index = layout.features.findIndex(item => item.id === feature.id);
      if (index < 0) layout.features.push(feature);
      else layout.features[index] = feature;
      return 'outline-' + feature.id;
    }
    const item = target.radius ?? ui.outlineDraft;
    const [x, y, z] = data.get('corner').split(',').map(Number);
    const radius = { ...item, x, y, z, radius: numeric('radius') };
    layout.radii = [...(layout.radii ?? [])];
    const index = layout.radii.findIndex(other => other.id === radius.id);
    if (index < 0) layout.radii.push(radius);
    else layout.radii[index] = radius;
    return 'radius-' + radius.id;
  }

  function applyColumns(data, preview = false) {
    const count = Number(data.get('count'));
    const typed = data.get('positions').trim();
    const positions = typed ? typed.split(',').map(value => value.trim() ? Number(value) : NaN) : undefined;
    const result = M.repartition(current(), count, data.has('accept'), positions);
    ui.preview = null;
    if (preview && result.preview) {
      ui.preview = result.preview;
      ui.view = 'front';
      renderView();
    }
    if (result.error) {
      message(result.error, true);
      if (!ui.preview) renderDrawing();
      return;
    }
    if (preview) {
      ui.preview = result.layout;
      ui.view = 'front';
      const width = M.sizeOf(result.layout).width;
      const bounds = [0, ...result.layout.dividers, width];
      message('Proposed widths: ' + bounds.slice(1).map((x, i) => x - bounds[i]).join(', ') +
        ' mm. ' + result.review + ' Select Apply to create this layout.');
      renderView();
      return;
    }
    const id = 'custom-' + newId();
    result.layout.name = data.get('layoutName').trim() || 'Custom ' + count;
    commitDocument({ ...plan, active: id, layouts: { ...plan.layouts, [id]: result.layout } }, 'Custom layout created.');
    ui.selected = 'bay-0';
    ui.bay = 0;
    ui.travel = Object.create(null);
    render();
    $('layouts').querySelector('[aria-pressed="true"]')?.focus();
  }

  function applyForm(form) {
    const target = selection();
    const { kind, index, part, key } = target;
    const data = new FormData(form);
    if (kind === 'columns') return applyColumns(data);
    ui.preview = null;
    const numeric = name => data.get(name) === '' ? null : Number(data.get(name));
    const layout = structuredClone(current());
    let nextSelection = ui.selected;
    if (kind === 'bay') {
      layout.bays[index] = { name: data.get('name').trim(), owner: data.get('owner') };
    } else if (kind === 'main') {
      layout.dividers[index] = numeric('x');
      if (layout.dividers[index] !== current().dividers[index]) delete layout.legacyPartition;
    } else if (kind === 'notch') {
      layout.notch = { enabled: data.has('enabled'), side: data.get('side'), y: numeric('y'),
        height: numeric('height'), width: numeric('width'), depth: numeric('depth') };
    } else if (kind === 'cabinet') {
      layout.size = { width: numeric('width'), height: numeric('height'), depth: numeric('depth') };
      if (layout.size.width !== M.sizeOf(current()).width) delete layout.legacyPartition;
    } else if (kind === 'callout') {
      layout.callouts = { ...layout.callouts, [key]: numeric('offset') };
    } else if (['feature', 'outline-new', 'radius', 'radius-new'].includes(kind)) {
      nextSelection = outlineEdit(layout, data, target);
    } else {
      const edited = { ...part, bay: numeric('bay') };
      for (const name of Object.keys(part)) {
        if (name !== 'id' && name !== 'type' && name !== 'bay' && data.has(name)) edited[name] = numeric(name);
      }
      if (part.type === 'rack' && edited.bay !== part.bay && edited.x === part.x) {
        const [oldLeft] = M.bayBounds(layout, part.bay);
        const [left, right] = M.bayBounds(layout, edited.bay);
        edited.x = Math.max(left, Math.min(right - edited.width, left + part.x - oldLeft));
      }
      layout.parts[layout.parts.findIndex(item => item.id === part.id)] = edited;
    }
    if (commit(layout, 'Layout updated.')) {
      if (kind === 'part') ui.bay = numeric('bay');
      if (kind === 'notch') ui.side = layout.notch.side;
      ui.selected = nextSelection;
      render();
      $('edit-form')?.querySelector('[type="submit"]')?.focus();
    } else renderDrawing();
  }

  const newId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);

  $('inspector').addEventListener('submit', event => {
    event.preventDefault();
    applyForm(event.target);
  });
  $('inspector').addEventListener('input', event => {
    if (ui.preview) {
      ui.preview = null;
      message();
      renderDrawing();
    }
    if (event.target.id !== 'pull-travel') return;
    const rack = selection().part;
    const distance = Number(event.target.value);
    ui.travel[rack.id] = distance / rack.travel;
    $('travel-value').textContent = distance + ' mm';
    if (ui.view === 'front') {
      ui.view = 'side';
    }
    renderView();
  });
  $('inspector').addEventListener('change', event => {
    if (event.target.name !== 'edge-template' || !event.target.value) return;
    const values = event.target.value.split(',');
    for (const [i, name] of ['edge', 'at', 'start', 'end', 'z1', 'z2'].entries()) {
      event.target.form.elements[name].value = values[i];
    }
  });
  $('inspector').addEventListener('click', event => {
    const action = event.target.dataset.action;
    if (action) {
      const layout = structuredClone(current());
      const { feature, radius, key } = selection();
      if (action === 'cut' || action === 'extend') {
        const { width, height, depth } = M.sizeOf(layout);
        ui.view = 'front';
        ui.outlineDraft = { id: 'feature-' + newId(), kind: action, edge: action === 'cut' ? 'left' : 'top',
          at: action === 'cut' ? 0 : height, start: Math.floor((action === 'cut' ? height : width) / 3),
          end: Math.floor((action === 'cut' ? height : width) * 2 / 3), offset: 100, z1: 0, z2: depth };
        choose('outline-new');
      } else if (action === 'round') {
        ui.view = 'front';
        ui.outlineDraft = { id: 'arc-' + newId(), x: 0, y: 0, z: 0, radius: 50 };
        choose('radius-new');
      } else if (action === 'reset-callout') {
        if (layout.callouts) delete layout.callouts[key];
        if (commit(layout)) render();
      } else if (action === 'remove-outline') {
        if (feature) layout.features = layout.features.filter(item => item.id !== feature.id);
        if (radius) layout.radii = layout.radii.filter(item => item.id !== radius.id);
        if (commit(layout)) choose('outline');
      } else if (action === 'preview-outline') {
        const form = event.target.form;
        if (!form.reportValidity()) return;
        outlineEdit(layout, new FormData(form), selection());
        const error = M.validateLayout(layout);
        ui.preview = error ? null : layout;
        message(error || 'Outline preview. Select Apply to keep it.', Boolean(error));
        renderDrawing();
      } else if (action === 'preview-columns' && event.target.form.reportValidity()) {
        applyColumns(new FormData(event.target.form), true);
      }
      return;
    }
    if (!event.target.matches('[data-remove]')) return;
    const layout = structuredClone(current());
    layout.parts = layout.parts.filter(part => part.id !== ui.selected);
    commit(layout);
    choose('bay-' + ui.bay);
    $('bays').querySelector('[aria-pressed="true"]').focus();
  });

  for (const container of [$('bays'), $('parts')]) {
    container.addEventListener('click', event => {
      const target = event.target.closest('[data-row]');
      if (!target) return;
      choose(target.dataset.row);
      [...container.querySelectorAll('[data-row]')].find(row => row.dataset.row === ui.selected)?.focus();
    });
  }
  $('layouts').addEventListener('click', event => {
    const id = event.target.dataset.layout;
    if (!id || id === String(plan.active)) return;
    if (drag) cancelDrag();
    plan = { ...plan, active: /^\d+$/.test(id) ? Number(id) : id };
    ui.bay = 0;
    ui.selected = 'bay-0';
    ui.preview = null;
    ui.travel = Object.create(null);
    message();
    save();
    render();
  });
  $('cabinet-button').addEventListener('click', () => choose('cabinet'));
  $('columns-button').addEventListener('click', () => choose('columns'));
  $('outline-button').addEventListener('click', () => choose('outline'));
  $('undo').addEventListener('click', () => restore('undo'));
  $('redo').addEventListener('click', () => restore('redo'));
  $('full-measurements').addEventListener('change', event => {
    ui.full = event.target.checked;
    renderDrawing();
  });
  $('snap').addEventListener('change', event => { ui.snap = event.target.checked; });
  $('custom-pointer').addEventListener('change', event => {
    drawing.classList.toggle('custom-pointer', event.target.checked);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) {
      cancelDrag();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || $('print-preview').open ||
        event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault();
    restore(key === 'y' || event.shiftKey ? 'redo' : 'undo');
  });
  $('views').addEventListener('click', event => {
    if (!event.target.dataset.view) return;
    if (drag) cancelDrag();
    ui.view = event.target.dataset.view;
    renderView();
  });
  $('side-view').addEventListener('change', event => {
    ui.side = event.target.value;
    renderDrawing();
  });

  $('add-button').addEventListener('click', () => {
    const layout = structuredClone(current());
    const type = $('add-type').value;
    const id = 'part-' + newId();
    const part = M.makePart(layout, type, ui.bay, id);
    layout.parts.push(part);
    if (layout.notch.enabled && M.validateLayout(layout)) {
      const [, , bottom, top] = M.partBounds(layout, part);
      const offsets = [layout.notch.y - top, layout.notch.y + layout.notch.height - bottom]
        .sort((a, b) => Math.abs(a) - Math.abs(b));
      for (const offset of offsets) {
        layout.parts[layout.parts.length - 1] = type === 'divider' ?
          { ...part, y1: part.y1 + offset, y2: part.y2 + offset } : { ...part, y: part.y + offset };
        if (!M.validateLayout(layout)) break;
      }
    }
    if (commit(layout)) {
      choose(id);
      $('inspector').querySelector('select').focus();
    }
  });

  function pointerPoint(event) {
    return new DOMPoint(event.clientX, event.clientY)
      .matrixTransform(drag?.inverse ?? drawing.getScreenCTM().inverse());
  }

  function movedLayout(original, target, axis, dx, dy, screenDelta) {
    const layout = structuredClone(original);
    const { kind, index, part, feature, key } = target;
    if (kind === 'main') {
      layout.dividers[index] += dx;
      if (dx) delete layout.legacyPartition;
    } else if (kind === 'notch') {
      layout.notch.y += dy;
    } else if (kind === 'callout') {
      const originalOffset = layout.callouts?.[key] ?? Drawing.callouts[key];
      const offset = Math.max(-340, Math.min(340, originalOffset + Math.round(screenDelta)));
      if (offset !== originalOffset) layout.callouts = { ...layout.callouts, [key]: offset };
    } else if (kind === 'feature') {
      const item = layout.features.find(item => item.id === feature.id);
      const vertical = feature.edge === 'left' || feature.edge === 'right';
      if (axis === 'feature-offset') {
        const sign = ['left', 'bottom'].includes(feature.edge) ? -1 : 1;
        item.offset += (vertical ? dx : dy) * sign * (feature.kind === 'cut' ? -1 : 1);
      } else {
        item[axis === 'feature-start' ? 'start' : 'end'] += vertical ? dy : dx;
      }
    } else if (part) {
      const moved = Move.movePart(part, axis === 'y' ? 0 : dx, axis === 'x' ? 0 : dy);
      if (dx && ['divider', 'rack'].includes(part.type)) {
        const center = moved.x + (moved.width ?? 0) / 2;
        const next = layout.dividers.findIndex(x => center < x);
        moved.bay = next < 0 ? layout.bays.length - 1 : next;
      }
      layout.parts[layout.parts.findIndex(item => item.id === part.id)] = moved;
    }
    return layout;
  }

  function snapCandidates(layout, part) {
    const candidates = [];
    const [a, b, c, d, e, f] = M.partBounds(layout, part);
    const add = (axis, value, edge, id) => candidates.push({
      axis, value, delta: Math.round(value - edge), id,
    });
    if (part.type === 'rack') {
      const geometry = M.outlineGeometry(layout);
      for (const [i, [x1, x2]] of geometry.slices((c + d) / 2, e, f).entries()) {
        if (Number.isInteger(x1)) add('x', x1, a, 'wall-left-' + i);
        if (Number.isInteger(x2)) add('x', x2, b, 'wall-right-' + i);
      }
      for (const [i, wall] of layout.dividers.entries()) {
        add('x', wall, a, 'divider-' + i + '-left');
        add('x', wall, b, 'divider-' + i + '-right');
      }
      const walls = geometry.sections.filter(section => section.z1 < f && section.z2 > e)
        .flatMap(section => section.segments.filter(([start, end]) => start[1] === end[1] &&
          Math.min(start[0], end[0]) < b && Math.max(start[0], end[0]) > a));
      for (const [i, [start, end]] of walls.entries()) {
        add('y', start[1], end[0] > start[0] ? c : d, 'wall-y-' + i);
      }
    } else if (part.type === 'shelf' || part.type === 'rail') {
      for (const neighbour of layout.parts) {
        if (neighbour.id === part.id || neighbour.type === 'divider') continue;
        const [left, right, low, high] = M.partBounds(layout, neighbour);
        if (Math.abs(neighbour.bay - part.bay) > 1 && (right < a || left > b)) continue;
        add('y', low, c, neighbour.id + '-low');
        if (high !== low) add('y', high, c, neighbour.id + '-high');
      }
    }
    return candidates;
  }

  drawing.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || ui.preview) return;
    const target = event.target.closest('[data-select]');
    if (!target) return;
    const axis = target.dataset.drag;
    const start = axis && pointerPoint(event);
    const frame = axis && Drawing.frame(current(), ui);
    const matrix = axis && drawing.getScreenCTM();
    const viewBox = drawing.getAttribute('viewBox');
    choose(target.dataset.select);
    if (!axis) return;
    const screenScale = Math.hypot(matrix.a, matrix.b);
    drag = { id: event.pointerId, axis, start, original: current(), frame, viewBox, inverse: matrix.inverse(),
      threshold: 3 / screenScale, tolerance: 10 / (screenScale * frame.scale), target: selection(), started: false };
    event.preventDefault();
    drawing.setPointerCapture(event.pointerId);
  });
  drawing.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const point = pointerPoint(event);
    const dx = Math.round((point.x - drag.start.x) / drag.frame.scale);
    const dy = Math.round((drag.start.y - point.y) / drag.frame.scale);
    const screenDelta = drag.axis === 'callout-x' ? point.x - drag.start.x : point.y - drag.start.y;
    if (!drag.started && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < drag.threshold) return;
    drag.started = true;
    let layout = movedLayout(drag.original, drag.target, drag.axis, dx, dy, screenDelta);
    drag.guide = null;
    if (ui.snap && drag.target.part && (dx || dy)) {
      const moved = layout.parts.find(part => part.id === drag.target.part.id);
      const snap = Move.nearestSnap(snapCandidates(layout, moved), drag.axis, drag.tolerance, candidate => {
        const snapped = movedLayout(drag.original, drag.target, drag.axis,
          dx + (candidate.axis === 'x' ? candidate.delta : 0), dy + (candidate.axis === 'y' ? candidate.delta : 0), 0);
        if (M.validateLayout(snapped)) return false;
        layout = snapped;
        return true;
      });
      if (snap) drag.guide = snap;
    }
    const error = M.validateLayout(layout);
    if (error) {
      message(error, true);
      renderDrawing();
      return;
    }
    drag.preview = layout;
    message();
    renderDrawing();
    renderInspector();
  });
  drawing.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const { preview } = drag;
    drag = null;
    if (preview) {
      commit(preview);
      if (selection().part) ui.bay = selection().part.bay;
    }
    render();
  });
  function cancelDrag(event) {
    if (!drag || event && event.pointerId !== drag.id) return;
    const id = drag.id;
    drag = null;
    if (drawing.hasPointerCapture(id)) drawing.releasePointerCapture(id);
    message();
    render();
  }
  drawing.addEventListener('pointercancel', cancelDrag);
  drawing.addEventListener('lostpointercapture', cancelDrag);

  $('export-button').addEventListener('click', () => {
    const json = new Blob([JSON.stringify(plan, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(json);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wardrobe-plan.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('import-button').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const request = ++pendingImport;
    try {
      const imported = M.parseDocument(await file.text());
      if (request !== pendingImport) return;
      if (drag) cancelDrag();
      ui.preview = null;
      commitDocument(imported, 'Plan imported.');
      ui.selected = 'bay-0';
      ui.bay = 0;
      ui.travel = Object.create(null);
      ui.side = current().notch.side;
      render();
    } catch (error) {
      if (request === pendingImport) message('Import failed. ' + error.message, true);
    }
  });

  function preparePrint(full) {
    const layout = plan.layouts[plan.active];
    const side = layout.notch.enabled && !M.hasCustomOutline(layout) ? layout.notch.side : ui.side;
    const description = layout.notch.enabled ? ' · ' + layout.notch.side + ' notch' : '';
    const { width, height, depth } = M.sizeOf(layout);
    $('print-sheet').innerHTML = '<h1>Wardrobe plan</h1><p>' + layout.bays.length +
      ' columns · ' + width + ' W × ' + height + ' H × ' + depth + ' D mm nominal' + description + '</p>' +
      '<p>Origin at bottom-left-front. +X right, +Y up, +Z toward the back.</p>' +
      '<div class="print-drawings' + (full ? ' full-print' : '') + '">' + Object.entries(viewNames).map(([view, title]) =>
        '<section class="print-view"><figure><figcaption>' + title + (view === 'side' ? ' · ' + side : '') +
        '</figcaption><svg viewBox="' + drawingViewBox(layout, view) + '" role="img" aria-label="' + title + '">' +
        Drawing.render(layout, { view, side, travel: ui.travel, interactive: false, full }) +
        '</svg></figure>' + (full ? measurementTable(layout, view) : '') + '</section>').join('') + '</div>';
  }
  function refreshPrintPreview() {
    preparePrint($('print-measurements').checked);
    $('print-preview-content').innerHTML = $('print-sheet').innerHTML;
  }
  $('print-button').addEventListener('click', () => {
    $('print-measurements').checked = ui.full;
    refreshPrintPreview();
    $('print-preview').showModal();
  });
  $('print-measurements').addEventListener('change', refreshPrintPreview);
  $('send-print').addEventListener('click', () => window.print());
  window.addEventListener('beforeprint', () => preparePrint($('print-preview').open ?
    $('print-measurements').checked : ui.full));
  render();
}());
