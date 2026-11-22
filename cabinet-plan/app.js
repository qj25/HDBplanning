(function () {
  'use strict';

  const M = window.WardrobeModel;
  const Drawing = window.WardrobeDrawing;
  const $ = id => document.getElementById(id);
  const drawing = $('drawing');
  const storageKey = 'wardrobe-planner-v1';
  const viewNames = { front: 'Front elevation', side: 'Side elevation', iso: 'Isometric' };
  const ui = { view: 'front', side: 'left', selected: 'bay-0', bay: 0, travel: Object.create(null) };
  const smallScreen = window.matchMedia('(max-width: 600px)');
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

  const current = () => plan.layouts[plan.active];
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
    const error = M.validateLayout(layout, plan.active);
    if (error) {
      message(error, true);
      return false;
    }
    plan.layouts[plan.active] = layout;
    message(feedback);
    save();
    return true;
  }

  function selection() {
    const id = ui.selected;
    const match = /^(bay|main)-(\d+)$/.exec(id);
    if (match) return { kind: match[1], index: Number(match[2]) };
    if (id === 'notch') return { kind: 'notch' };
    return { kind: 'part', part: current().parts.find(item => item.id === id) };
  }

  function choose(id) {
    ui.selected = id;
    const target = selection();
    if (target.kind === 'bay') ui.bay = target.index;
    if (target.kind === 'part') ui.bay = target.part.bay;
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
      note = 'See the rail travel in Side or Isometric view. The mount stays at Z = 600 mm.';
    } else if (part.type === 'divider') {
      fields += num('x', 'X') + num('y1', 'Bottom Y') + num('y2', 'Top Y') +
        num('z1', 'Front Z') + num('z2', 'Back Z');
    } else {
      const [left, right] = M.bayBounds(current(), part.bay);
      fields += num('x1', 'Start X', String(left) + ' (bay edge)') +
        num('x2', 'End X', String(right) + ' (bay edge)') + num('y', 'Height Y');
      fields += part.type === 'shelf' ? num('z1', 'Front Z') + num('z2', 'Back Z') : num('z', 'Depth Z');
      note = 'Leave an X endpoint blank to follow that bay edge.';
    }
    return inspector(M.TYPES[part.type], 'Positions and dimensions in mm', fields, note, true);
  }

  function renderInspector() {
    const { kind, index, part } = selection();
    const layout = current();
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
      row('notch', 'Side notch', layout.notch.enabled ? layout.notch.side : 'Off');
    $('parts').innerHTML = fixtures + layout.bays.map((bay, i) => {
      const parts = layout.parts.filter(part => part.bay === i);
      if (!parts.length) return '';
      const open = i === ui.bay || openBays.has(String(i));
      return '<details data-group="' + i + '"' + (open ? ' open' : '') + '><summary>' +
        esc(bay.name || 'Bay ' + (i + 1)) + ' parts</summary><div>' +
        parts.map(part => row(part.id, M.TYPES[part.type],
          part.type === 'divider' ? 'X ' + part.x : 'Y ' + part.y)).join('') + '</div></details>';
    }).join('');
    for (const button of $('layouts').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', Number(button.dataset.count) === plan.active);
    }
    $('add-type').previousElementSibling.textContent = 'Add to ' + (layout.bays[ui.bay].name || 'Bay ' + (ui.bay + 1));
  }

  function renderDrawing() {
    drawing.innerHTML = Drawing.render(current(), ui);
    drawing.setAttribute('aria-label', viewNames[ui.view] + ', ' + plan.active + '-column wardrobe');
    drawing.setAttribute('viewBox', smallScreen.matches ? '100 0 520 630' : '0 0 720 630');
  }

  function render() {
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

  function applyForm(form) {
    const { kind, index, part } = selection();
    const data = new FormData(form);
    const numeric = name => data.get(name) === '' ? null : Number(data.get(name));
    const layout = structuredClone(current());
    if (kind === 'bay') {
      layout.bays[index] = { name: data.get('name').trim(), owner: data.get('owner') };
    } else if (kind === 'main') {
      layout.dividers[index] = numeric('x');
    } else if (kind === 'notch') {
      layout.notch = { enabled: data.has('enabled'), side: data.get('side'), y: numeric('y'),
        height: numeric('height'), width: numeric('width'), depth: numeric('depth') };
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
      render();
      $('edit-form').querySelector('[type="submit"]').focus();
    }
  }

  $('inspector').addEventListener('submit', event => {
    event.preventDefault();
    applyForm(event.target);
  });
  $('inspector').addEventListener('input', event => {
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
  $('inspector').addEventListener('click', event => {
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
    const count = Number(event.target.dataset.count);
    if (!count || count === plan.active) return;
    plan.active = count;
    ui.bay = 0;
    ui.selected = 'bay-0';
    ui.travel = Object.create(null);
    message();
    save();
    render();
  });
  $('views').addEventListener('click', event => {
    if (!event.target.dataset.view) return;
    ui.view = event.target.dataset.view;
    renderView();
  });
  smallScreen.addEventListener('change', renderDrawing);
  $('side-view').addEventListener('change', event => {
    ui.side = event.target.value;
    renderDrawing();
  });

  $('add-button').addEventListener('click', () => {
    const layout = structuredClone(current());
    const type = $('add-type').value;
    const id = 'part-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
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
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(drawing.getScreenCTM().inverse());
  }

  drawing.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    const target = event.target.closest('[data-select]');
    if (!target) return;
    const axis = target.dataset.drag;
    const start = axis && pointerPoint(event);
    choose(target.dataset.select);
    if (!axis) return;
    drag = { id: event.pointerId, axis, start, original: structuredClone(current()), changed: false };
    drawing.setPointerCapture(event.pointerId);
  });
  drawing.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const point = pointerPoint(event);
    const delta = Math.round((drag.axis === 'x' ? point.x - drag.start.x : drag.start.y - point.y) / Drawing.scale);
    if (!drag.changed && Math.abs(delta) < 3) return;
    const layout = structuredClone(drag.original);
    const { kind, index, part } = selection();
    if (kind === 'main') layout.dividers[index] += delta;
    else if (kind === 'notch') layout.notch.y += delta;
    else {
      const item = layout.parts.find(item => item.id === part.id);
      item[drag.axis] += delta;
    }
    const error = M.validateLayout(layout, plan.active);
    if (error) {
      message(error, true);
      return;
    }
    plan.layouts[plan.active] = layout;
    drag.changed = true;
    message();
    renderDrawing();
    renderInspector();
  });
  drawing.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const changed = drag.changed;
    drag = null;
    if (changed) save();
    render();
  });
  function cancelDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    plan.layouts[plan.active] = drag.original;
    drag = null;
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
      plan = imported;
      ui.selected = 'bay-0';
      ui.bay = 0;
      ui.travel = Object.create(null);
      ui.side = current().notch.side;
      message('Plan imported.');
      save();
      render();
    } catch (error) {
      if (request === pendingImport) message('Import failed. ' + error.message, true);
    }
  });

  function preparePrint() {
    const layout = current();
    const side = layout.notch.enabled ? layout.notch.side : ui.side;
    const description = layout.notch.enabled ? ' · ' + side + ' notch' : '';
    $('print-sheet').innerHTML = '<h1>Wardrobe plan</h1><p>' + plan.active +
      ' columns · 1821 W × 2600 H × 600 D mm' + description + '</p>' +
      '<p>Origin at bottom-left-front. +X right, +Y up, +Z toward the back.</p>' +
      '<div class="print-drawings">' + Object.entries(viewNames).map(([view, title]) =>
        '<figure><figcaption>' + title + (view === 'side' ? ' · ' + side : '') +
        '</figcaption><svg viewBox="0 0 720 630" role="img" aria-label="' + title + '">' +
        Drawing.render(layout, { view, side, selected: '', travel: ui.travel, interactive: false }) +
        '</svg></figure>').join('') + '</div>';
  }
  $('print-button').addEventListener('click', () => {
    preparePrint();
    $('print-preview-content').innerHTML = $('print-sheet').innerHTML;
    $('print-preview').showModal();
  });
  $('send-print').addEventListener('click', () => window.print());
  window.addEventListener('beforeprint', preparePrint);
  render();
}());
