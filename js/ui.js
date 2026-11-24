'use strict';
/* UI: menus, toolbar, options bar, panels, dialogs, input handling, file I/O */
(function (App) {
  const U = App.util;

  // ------------------------------------------------------------ helpers
  const h = U.h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  };
  const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const ICON = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    merge: '<path d="M7 4l5 5 5-5M12 9v8M5 20h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    swap: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
  };
  const fmtNum = (v) => (Math.round(v * 10) / 10).toString();
  const isTyping = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable]');

  function sliderRow(label, min, max, step, value, unit, onInput, title) {
    const val = h('span', { class: 'val' });
    const input = h('input', { type: 'range', min, max, step });
    input.value = value;
    const set = () => { val.textContent = fmtNum(+input.value) + (unit || ''); };
    input.addEventListener('input', () => { set(); onInput(+input.value); });
    set();
    return h('label', { class: 'row slider', title: title || null }, h('span', { class: 'lbl' }, label), input, val);
  }
  function checkRow(label, value, onChange) {
    const input = h('input', { type: 'checkbox' });
    input.checked = !!value;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'row check' }, input, h('span', {}, label));
  }
  function numField(label, value, attrs) {
    const input = h('input', Object.assign({ type: 'number', value }, attrs || {}));
    return { el: h('label', { class: 'row' }, h('span', { class: 'lbl' }, label), input), input };
  }

  // ------------------------------------------------------------- dialog
  let modalCount = 0;
  function dialog({ title, content, okLabel = 'OK', cancelLabel = 'Cancel', onOk, onCancel, light, noCancel }) {
    const back = h('div', { class: 'modal-back' + (light ? ' light' : '') });
    const close = () => { back.remove(); modalCount--; };
    const ok = () => { if (onOk && onOk() === false) return; close(); };
    const cancel = () => { if (onCancel) onCancel(); close(); };
    const box = h('div', { class: 'modal', role: 'dialog' },
      h('div', { class: 'modal-head' }, title),
      h('div', { class: 'modal-body' }, content),
      h('div', { class: 'modal-foot' },
        noCancel ? null : h('button', { class: 'btn', onclick: cancel }, cancelLabel),
        h('button', { class: 'btn primary', onclick: ok }, okLabel)));
    back.appendChild(box);
    back.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); ok(); }
    });
    back.addEventListener('pointerdown', (e) => { if (e.target === back && !light) cancel(); });
    document.body.appendChild(back);
    modalCount++;
    const first = box.querySelector('textarea, input:not([type=checkbox]):not([type=range]), select') || box.querySelector('.btn.primary');
    setTimeout(() => { first.focus(); if (first.select) first.select(); }, 0);
    return { close, el: box };
  }

  App.ui = { dialog, sliderRow, checkRow, h, svg, get modalOpen() { return modalCount > 0; } };

  // ------------------------------------------------------------- dialogs
  function newDocDialog() {
    const presets = [['1200×800', 1200, 800], ['1920×1080 (HD)', 1920, 1080], ['1080×1080 (Square)', 1080, 1080], ['1080×1920 (Story)', 1080, 1920],
      ['1024×1024', 1024, 1024], ['2480×3508 (A4 300dpi)', 2480, 3508], ['800×600', 800, 600]];
    const w = numField('Width', 1200, { min: 1, max: 12000 }), hh = numField('Height', 800, { min: 1, max: 12000 });
    const preset = h('select', {}, presets.map(([l], i) => h('option', { value: i }, l)));
    preset.onchange = () => { const p = presets[preset.value]; w.input.value = p[1]; hh.input.value = p[2]; };
    const bg = h('select', {}, h('option', { value: '#ffffff' }, 'White'), h('option', { value: 'transparent' }, 'Transparent'),
      h('option', { value: 'bgcolor' }, 'Background color'), h('option', { value: '#000000' }, 'Black'));
    dialog({
      title: 'New Document', okLabel: 'Create',
      content: h('div', { class: 'form' }, h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Preset'), preset), w.el, hh.el,
        h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Background'), bg)),
      onOk: () => {
        const W = Math.round(+w.input.value), H = Math.round(+hh.input.value);
        if (!(W > 0 && H > 0 && W <= 12000 && H <= 12000)) { App.toast('Size must be 1–12000 px', 'error'); return false; }
        if (!App.isPristine() && !confirm('Discard the current document?')) return false;
        App.newDocument(W, H, bg.value === 'bgcolor' ? App.colors.bg : bg.value);
      },
    });
  }

  function imageSizeDialog() {
    const d = App.doc, ratio = d.width / d.height;
    const w = numField('Width', d.width, { min: 1, max: 12000 }), hh = numField('Height', d.height, { min: 1, max: 12000 });
    let lock = true;
    w.input.oninput = () => { if (lock) hh.input.value = Math.max(1, Math.round(+w.input.value / ratio)); };
    hh.input.oninput = () => { if (lock) w.input.value = Math.max(1, Math.round(+hh.input.value * ratio)); };
    dialog({
      title: 'Image Size', okLabel: 'Resize',
      content: h('div', { class: 'form' }, w.el, hh.el, checkRow('Constrain proportions', true, v => { lock = v; })),
      onOk: () => {
        const W = Math.round(+w.input.value), H = Math.round(+hh.input.value);
        if (!(W > 0 && H > 0 && W <= 12000 && H <= 12000)) { App.toast('Invalid size', 'error'); return false; }
        App.ops.imageSize(W, H);
      },
    });
  }

  function canvasSizeDialog() {
    const d = App.doc;
    const w = numField('Width', d.width, { min: 1, max: 12000 }), hh = numField('Height', d.height, { min: 1, max: 12000 });
    let ax = 0.5, ay = 0.5;
    const grid = h('div', { class: 'anchor' });
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const b = h('button', { class: i === 1 && j === 1 ? 'on' : '', title: 'Anchor' });
      b.onclick = (e) => { e.preventDefault(); ax = i / 2; ay = j / 2; grid.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); };
      grid.appendChild(b);
    }
    dialog({
      title: 'Canvas Size', okLabel: 'Apply',
      content: h('div', { class: 'form' }, w.el, hh.el, h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Anchor'), grid)),
      onOk: () => {
        const W = Math.round(+w.input.value), H = Math.round(+hh.input.value);
        if (!(W > 0 && H > 0 && W <= 12000 && H <= 12000)) { App.toast('Invalid size', 'error'); return false; }
        App.ops.canvasSize(W, H, ax, ay);
      },
    });
  }

  function radiusDialog(title, label, value, fn) {
    const f = numField(label, value, { min: 0, max: 500, step: 0.5 });
    dialog({ title, content: h('div', { class: 'form' }, f.el), onOk: () => fn(+f.input.value) });
  }

  async function exportImage(type, quality, name) {
    const comp = App.getComposite();
    let c = comp;
    if (type === 'image/jpeg') {
      c = U.canvas(comp.width, comp.height);
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(comp, 0, 0);
    }
    const blob = await U.canvasToBlob(c, type, quality);
    if (!blob) { App.toast('Export failed', 'error'); return; }
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type];
    U.download(blob, `${name || App.doc.name || 'image'}.${ext}`);
    App.history.saved = App.history.index;
  }

  function exportDialog() {
    const fmt = h('select', {}, h('option', { value: 'image/png' }, 'PNG'), h('option', { value: 'image/jpeg' }, 'JPEG'), h('option', { value: 'image/webp' }, 'WebP'));
    let q = 92;
    const qRow = sliderRow('Quality', 10, 100, 1, q, '%', v => { q = v; });
    qRow.hidden = true;
    fmt.onchange = () => { qRow.hidden = fmt.value === 'image/png'; };
    const name = h('input', { type: 'text', value: App.doc.name || 'image' });
    dialog({
      title: 'Export As', okLabel: 'Export',
      content: h('div', { class: 'form' }, h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'File name'), name),
        h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Format'), fmt), qRow),
      onOk: () => { exportImage(fmt.value, q / 100, name.value.trim() || 'image'); },
    });
  }

  App.ui.textDialog = (p) => {
    const L = App.layers.add('Text', { history: false });
    const s = { text: '', size: 64, font: 'Arial', bold: false, italic: false, align: 'left', color: App.colors.fg, stroke: false };
    const draw = () => {
      const c = L.ctx;
      c.clearRect(0, 0, L.canvas.width, L.canvas.height);
      c.font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.size}px "${s.font}"`;
      c.textBaseline = 'top';
      c.textAlign = s.align;
      c.fillStyle = s.color;
      c.lineJoin = 'round';
      c.lineWidth = Math.max(2, s.size / 12);
      c.strokeStyle = U.hexToRgb(s.color).r + U.hexToRgb(s.color).g + U.hexToRgb(s.color).b > 382 ? '#000' : '#fff';
      (s.text || 'Your text').split('\n').forEach((ln, i) => {
        const y = p.y + i * s.size * 1.2;
        if (s.stroke) c.strokeText(ln, p.x, y);
        c.fillText(ln, p.x, y);
      });
      if (!s.text) { c.globalCompositeOperation = 'destination-in'; c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, L.canvas.width, L.canvas.height); c.globalCompositeOperation = 'source-over'; }
      L.name = 'T  ' + (s.text || 'Text').split('\n')[0].slice(0, 28);
      App.layerChanged(L);
      App.emit('layers');
    };
    const ta = h('textarea', { rows: 3, placeholder: 'Type your text…' });
    ta.oninput = () => { s.text = ta.value; draw(); };
    const fonts = ['Arial', 'Helvetica', 'Verdana', 'Trebuchet MS', 'Segoe UI', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'Comic Sans MS'];
    const fontSel = h('select', {}, fonts.map(f => h('option', { value: f }, f)));
    fontSel.onchange = () => { s.font = fontSel.value; draw(); };
    const color = h('input', { type: 'color', value: s.color });
    color.oninput = () => { s.color = color.value; draw(); };
    const align = h('select', {}, h('option', { value: 'left' }, 'Left'), h('option', { value: 'center' }, 'Center'), h('option', { value: 'right' }, 'Right'));
    align.onchange = () => { s.align = align.value; draw(); };
    const remove = () => {
      const i = App.doc.layers.indexOf(L);
      if (i >= 0) { App.doc.layers.splice(i, 1); App.doc.active = U.clamp(i - 1, 0, App.doc.layers.length - 1); }
      App.markDirty(); App.emit('layers');
    };
    dialog({
      title: 'Add Text', okLabel: 'Add', light: true,
      content: h('div', { class: 'form' }, ta,
        h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Font'), fontSel),
        sliderRow('Size', 6, 400, 1, s.size, 'px', v => { s.size = v; draw(); }),
        h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Color'), color),
        h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Align'), align),
        checkRow('Bold', false, v => { s.bold = v; draw(); }),
        checkRow('Italic', false, v => { s.italic = v; draw(); }),
        checkRow('Outline', false, v => { s.stroke = v; draw(); })),
      onOk: () => { if (!s.text.trim()) { remove(); return; } draw(); App.history.push('Text'); },
      onCancel: remove,
    });
    draw();
  };

  function shortcutsDialog() {
    const rows = [
      ['V / M / O / L / W', 'Move / Rect / Ellipse / Lasso / Wand'],
      ['C / I / B / E / G / N', 'Crop / Eyedropper / Brush / Eraser / Fill / Gradient'],
      ['U / T / H / Z', 'Shape / Text / Hand / Zoom'],
      ['[  ]', 'Brush size'], ['X / D', 'Swap / reset colors'], ['Space + drag', 'Pan'],
      ['Mouse wheel', 'Zoom (Shift = pan)'],
      ['Shift / Alt while selecting', 'Add / subtract'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'],
      ['Ctrl+A / Ctrl+D / Ctrl+Shift+I', 'Select all / Deselect / Inverse'],
      ['Ctrl+J', 'Layer via copy'], ['Delete', 'Clear selection'],
      ['Ctrl+K', 'Focus the Gemini prompt'], ['Ctrl+Enter (in prompt)', 'Run Gemini'],
      ['Ctrl+0 / Ctrl+1', 'Fit / 100%'],
    ];
    dialog({
      title: 'Keyboard Shortcuts', okLabel: 'Close', noCancel: true,
      content: h('table', { class: 'keys' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))),
    });
  }

  // ----------------------------------------------------------- file I/O
  const fileInput = () => document.getElementById('file-input');
  let fileMode = 'open';
  function openFile(mode) { fileMode = mode; fileInput().click(); }

  async function handleFiles(files, mode) {
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    if (!imgs.length) { App.toast('No image files found'); return; }
    for (let i = 0; i < imgs.length; i++) {
      const f = imgs[i];
      try {
        const img = await U.fileToImage(f);
        const base = f.name.replace(/\.[^.]+$/, '');
        const asOpen = mode === 'open' || (mode === 'auto' && i === 0 && App.isPristine());
        if (asOpen) {
          if (mode === 'open' && !App.isPristine() && !confirm('Discard the current document and open this image?')) return;
          App.openImage(img, 'Background');
          App.doc.name = base;
          mode = 'place';
        } else App.ops.placeImage(img, base);
      } catch (e) { App.toast('Could not open ' + f.name, 'error'); }
    }
  }

  async function pasteFromSystem() {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find(x => x.startsWith('image/'));
        if (t) { const blob = await it.getType(t); await handleFiles([new File([blob], 'Pasted.png', { type: t })], 'auto'); return; }
      }
    } catch (e) { /* fall through */ }
    App.ops.pasteInternal();
  }

  // ---------------------------------------------------------------- menus
  const F = () => App.filters;
  const MENUS = [
    ['File', [
      ['New…', 'Ctrl+N', newDocDialog],
      ['Open…', 'Ctrl+O', () => openFile('open')],
      ['Place Image as Layer…', 'Ctrl+Shift+O', () => openFile('place')],
      '-',
      ['Export as PNG', 'Ctrl+S', () => exportImage('image/png')],
      ['Export As…', 'Ctrl+Shift+S', exportDialog],
    ]],
    ['Edit', [
      ['Undo', 'Ctrl+Z', () => App.history.undo(), () => App.history.canUndo()],
      ['Redo', 'Ctrl+Shift+Z', () => App.history.redo(), () => App.history.canRedo()],
      '-',
      ['Cut', 'Ctrl+X', () => App.ops.cut()],
      ['Copy', 'Ctrl+C', () => App.ops.copy(false)],
      ['Copy Merged', 'Ctrl+Shift+C', () => App.ops.copy(true)],
      ['Paste', 'Ctrl+V', pasteFromSystem],
      '-',
      ['Fill with Foreground', 'Alt+Backspace', () => App.ops.fill(App.colors.fg)],
      ['Fill with Background', 'Ctrl+Backspace', () => App.ops.fill(App.colors.bg)],
      ['Clear', 'Delete', () => App.ops.clear()],
    ]],
    ['Image', [
      ['Image Size…', 'Ctrl+Alt+I', imageSizeDialog],
      ['Canvas Size…', 'Ctrl+Alt+C', canvasSizeDialog],
      '-',
      ['Rotate 90° Clockwise', '', () => App.ops.rotate(90)],
      ['Rotate 90° Counter-clockwise', '', () => App.ops.rotate(-90)],
      ['Rotate 180°', '', () => App.ops.rotate(180)],
      ['Flip Canvas Horizontal', '', () => App.ops.flip(true)],
      ['Flip Canvas Vertical', '', () => App.ops.flip(false)],
      '-',
      ['Crop to Selection', '', () => App.ops.cropToSelection(), () => App.selection.has()],
    ]],
    ['Layer', [
      ['New Layer', 'Ctrl+Shift+N', () => App.layers.add()],
      ['Duplicate Layer', '', () => App.layers.duplicate()],
      ['Layer via Copy', 'Ctrl+J', () => App.layers.viaCopy(false)],
      ['Layer via Cut', 'Ctrl+Shift+J', () => App.layers.viaCopy(true), () => App.selection.has()],
      ['Delete Layer', '', () => App.layers.remove()],
      '-',
      ['Bring Forward', 'Ctrl+]', () => App.layers.move(1)],
      ['Send Backward', 'Ctrl+[', () => App.layers.move(-1)],
      ['Merge Down', 'Ctrl+E', () => App.layers.mergeDown()],
      ['Flatten Image', '', () => App.layers.flatten()],
      '-',
      ['Flip Layer Horizontal', '', () => App.ops.flipLayer(true)],
      ['Flip Layer Vertical', '', () => App.ops.flipLayer(false)],
    ]],
    ['Select', [
      ['All', 'Ctrl+A', () => App.selection.all()],
      ['Deselect', 'Ctrl+D', () => App.selection.none(), () => App.selection.has()],
      ['Inverse', 'Ctrl+Shift+I', () => App.selection.invert()],
      '-',
      ['Feather…', 'Shift+F6', () => radiusDialog('Feather Selection', 'Radius (px)', 8, r => App.selection.feather(r)), () => App.selection.has()],
      ['Expand…', '', () => radiusDialog('Expand Selection', 'By (px)', 5, r => App.selection.grow(r)), () => App.selection.has()],
      ['Contract…', '', () => radiusDialog('Contract Selection', 'By (px)', 5, r => App.selection.grow(-r)), () => App.selection.has()],
      ['Load Layer Transparency', '', () => App.selection.fromLayer()],
    ]],
    ['Adjust', [
      ['Brightness/Contrast…', '', () => F().brightnessContrast()],
      ['Levels…', 'Ctrl+L', () => F().levels()],
      ['Hue/Saturation…', 'Ctrl+U', () => F().hueSaturation()],
      ['Vibrance…', '', () => F().vibrance()],
      ['Color Temperature…', '', () => F().temperature()],
      '-',
      ['Auto Levels', 'Ctrl+Shift+L', () => F().autoLevels()],
      ['Desaturate', 'Ctrl+Shift+U', () => F().desaturate()],
      ['Invert', 'Ctrl+I', () => F().invert()],
      ['Sepia', '', () => F().sepia()],
      ['Posterize…', '', () => F().posterize()],
      ['Threshold…', '', () => F().threshold()],
    ]],
    ['Filter', [
      ['Gaussian Blur…', '', () => F().blur()],
      ['Unsharp Mask…', '', () => F().sharpen()],
      ['Add Noise…', '', () => F().noise()],
      ['Pixelate…', '', () => F().pixelate()],
      ['Vignette…', '', () => F().vignette()],
    ]],
    ['AI', [
      ['Gemini Prompt', 'Ctrl+K', () => App.gemini.focusPrompt()],
      ['Use Selection as Reference Image', '', () => App.gemini.addSelectionAsRef()],
    ]],
    ['View', [
      ['Zoom In', 'Ctrl+=', () => App.view.step(1)],
      ['Zoom Out', 'Ctrl+-', () => App.view.step(-1)],
      ['Fit on Screen', 'Ctrl+0', () => App.view.fit(true)],
      ['Actual Pixels', 'Ctrl+1', () => App.view.actual()],
    ]],
    ['Help', [
      ['Keyboard Shortcuts', 'F1', shortcutsDialog],
    ]],
  ];

  const SHORTCUTS = {};
  for (const [, items] of MENUS) for (const it of items) if (Array.isArray(it) && it[1]) SHORTCUTS[it[1]] = it;
  Object.assign(SHORTCUTS, {
    'Ctrl+Y': ['Redo', '', () => App.history.redo()],
    'Ctrl++': ['Zoom In', '', () => App.view.step(1)],
    'Ctrl+Shift++': ['Zoom In', '', () => App.view.step(1)],
    'Ctrl+Shift+=': ['Zoom In', '', () => App.view.step(1)],
    'Backspace': ['Clear', '', () => App.ops.clear()],
  });
  delete SHORTCUTS['Ctrl+V']; // handled by the native paste event

  let openMenu = null;
  function buildMenus() {
    const bar = document.getElementById('menubar');
    const closeAll = () => { if (openMenu) openMenu.classList.remove('open'); openMenu = null; };
    for (const [title, items] of MENUS) {
      const drop = h('div', { class: 'menu-drop' });
      const m = h('div', { class: 'menu' }, h('button', { class: 'menu-title' }, title), drop);
      const fill = () => {
        drop.innerHTML = '';
        for (const it of items) {
          if (it === '-') { drop.appendChild(h('div', { class: 'sep' })); continue; }
          const [label, sc, fn, enabled] = it;
          const dis = enabled ? !enabled() : false;
          drop.appendChild(h('button', {
            class: 'menu-item', disabled: dis,
            onclick: () => { closeAll(); if (App.busyTool()) return; fn(); },
          }, h('span', {}, label), h('span', { class: 'sc' }, sc || '')));
        }
      };
      m.firstChild.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (openMenu === m) { closeAll(); return; }
        closeAll(); fill(); m.classList.add('open'); openMenu = m;
      });
      m.firstChild.addEventListener('pointerenter', () => {
        if (openMenu && openMenu !== m) { closeAll(); fill(); m.classList.add('open'); openMenu = m; }
      });
      bar.appendChild(m);
    }
    bar.appendChild(h('div', { class: 'brand' }, 'SKETCH', h('span', {}, ' · AI image editor')));
    document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeAll(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  }

  // -------------------------------------------------------------- toolbar
  function buildToolbar() {
    const tb = document.getElementById('toolbar');
    const groups = [['move'], ['rect', 'ellipse', 'lasso', 'wand'], ['crop', 'eyedropper'], ['brush', 'eraser', 'fill', 'gradient'], ['shape', 'text'], ['hand', 'zoom']];
    for (const g of groups) {
      const grp = h('div', { class: 'tool-group' });
      for (const id of g) {
        const t = App.tools.byId[id];
        grp.appendChild(h('button', { class: 'tool', 'data-tool': id, title: `${t.name} (${t.key.toUpperCase()})`, html: svg(t.icon), onclick: () => App.tools.select(id) }));
      }
      tb.appendChild(grp);
    }
    const fg = h('input', { type: 'color', class: 'swatch fg', title: 'Foreground color' });
    const bg = h('input', { type: 'color', class: 'swatch bg', title: 'Background color' });
    fg.oninput = () => App.setColor('fg', fg.value);
    bg.oninput = () => App.setColor('bg', bg.value);
    const colors = h('div', { class: 'colors' }, bg, fg,
      h('button', { class: 'mini swap', title: 'Swap colors (X)', html: svg(ICON.swap), onclick: App.swapColors }),
      h('button', { class: 'mini reset', title: 'Default colors (D)', onclick: App.resetColors }, h('i'), h('i')));
    tb.appendChild(colors);
    const sync = () => { fg.value = App.colors.fg; bg.value = App.colors.bg; };
    App.on('colors', sync); sync();
    App.on('tool', (t) => {
      tb.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t.id));
      updateCursor();
    });
  }

  // ---------------------------------------------------------- options bar
  function buildOptions() {
    const bar = document.getElementById('optionsbar');
    const O = App.opts;
    const render = () => {
      const t = App.tools.current;
      bar.innerHTML = '';
      bar.appendChild(h('div', { class: 'opt-title', html: svg(t.icon) + `<span>${t.name}</span>` }));
      for (const o of t.options || []) {
        if (o.type === 'range') bar.appendChild(sliderRow(o.label, o.min, o.max, o.step || 1, O[o.key], o.unit || '', v => { O[o.key] = v; App.requestRender(); }));
        else if (o.type === 'check') bar.appendChild(checkRow(o.label, O[o.key], v => { O[o.key] = v; }));
        else if (o.type === 'seg') {
          const seg = h('div', { class: 'seg' });
          for (const [v, l, title] of o.options) {
            const b = h('button', { class: O[o.key] === v ? 'on' : '', title: title || l }, l);
            b.onclick = () => { O[o.key] = v; seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
            seg.appendChild(b);
          }
          bar.appendChild(h('div', { class: 'row' }, o.label ? h('span', { class: 'lbl' }, o.label) : null, seg));
        } else if (o.type === 'button') bar.appendChild(h('button', { class: 'btn sm' + (o.primary ? ' primary' : ''), onclick: o.action }, o.label));
        else if (o.type === 'info') bar.appendChild(h('span', { class: 'hint' }, o.text));
      }
    };
    App.on('tool', render);
    App.on('opts', render);
  }

  // --------------------------------------------------------------- layers
  const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'],
    ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'], ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'], ['difference', 'Difference'],
    ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']];

  function buildLayers() {
    const list = document.getElementById('layer-list');
    const blend = document.getElementById('layer-blend');
    const op = document.getElementById('layer-opacity');
    const opv = document.getElementById('layer-opacity-val');
    BLENDS.forEach(([v, l]) => blend.appendChild(h('option', { value: v }, l)));
    blend.onchange = () => App.layers.setProp(App.activeLayer(), 'blend', blend.value, 'Blend Mode');
    op.oninput = () => { opv.textContent = op.value + '%'; App.activeLayer().opacity = op.value / 100; App.markDirty(); };
    op.onchange = () => App.history.push('Layer Opacity');

    const actions = document.getElementById('layer-actions');
    [[ICON.plus, 'New layer', () => App.layers.add()], [ICON.dup, 'Duplicate layer', () => App.layers.duplicate()],
      [ICON.up, 'Move up', () => App.layers.move(1)], [ICON.down, 'Move down', () => App.layers.move(-1)],
      [ICON.merge, 'Merge down', () => App.layers.mergeDown()], [ICON.trash, 'Delete layer', () => App.layers.remove()]]
      .forEach(([ic, t, fn]) => actions.appendChild(h('button', { class: 'icon-btn', title: t, html: svg(ic), onclick: () => { if (!App.busyTool()) fn(); } })));

    const thumbs = new Map();
    const drawThumb = (L, c) => {
      const x = c.getContext('2d'), d = App.doc;
      const s = Math.min(c.width / d.width, c.height / d.height);
      const w = d.width * s, hh = d.height * s, ox = (c.width - w) / 2, oy = (c.height - hh) / 2;
      x.clearRect(0, 0, c.width, c.height);
      x.fillStyle = '#fff'; x.fillRect(ox, oy, w, hh);
      x.fillStyle = '#ddd';
      for (let yy = 0; yy < hh; yy += 4) for (let xx = (yy / 4) % 2 ? 4 : 0; xx < w; xx += 8) x.fillRect(ox + xx, oy + yy, Math.min(4, w - xx), Math.min(4, hh - yy));
      x.imageSmoothingQuality = 'medium';
      x.drawImage(L.canvas, ox, oy, w, hh);
    };
    const render = () => {
      const d = App.doc; if (!d) return;
      list.innerHTML = '';
      thumbs.clear();
      for (let i = d.layers.length - 1; i >= 0; i--) {
        const L = d.layers[i];
        const thumb = h('canvas', { width: 48, height: 36, class: 'thumb', title: 'Ctrl+click: select layer pixels' });
        drawThumb(L, thumb);
        thumbs.set(L, thumb);
        const eye = h('button', { class: 'eye' + (L.visible ? ' on' : ''), title: 'Toggle visibility', html: L.visible ? svg(ICON.eye) : '' });
        eye.onclick = (e) => { e.stopPropagation(); App.layers.setProp(L, 'visible', !L.visible, L.visible ? 'Hide Layer' : 'Show Layer'); };
        const name = h('span', { class: 'lname' }, L.name);
        name.ondblclick = (e) => {
          e.stopPropagation();
          const inp = h('input', { type: 'text', value: L.name, class: 'rename' });
          name.replaceWith(inp); inp.focus(); inp.select();
          const done = (save) => { if (save && inp.value.trim() && inp.value !== L.name) App.layers.setProp(L, 'name', inp.value.trim(), 'Rename Layer'); else render(); };
          inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
          inp.onblur = () => done(true);
        };
        const meta = [];
        if (L.blend !== 'source-over') meta.push(BLENDS.find(b => b[0] === L.blend)[1]);
        if (L.opacity < 1) meta.push(Math.round(L.opacity * 100) + '%');
        const row = h('div', { class: 'layer' + (i === d.active ? ' active' : '') + (L.visible ? '' : ' hidden') },
          eye, thumb, h('div', { class: 'linfo' }, name, meta.length ? h('span', { class: 'lmeta' }, meta.join(' · ')) : null));
        row.onclick = (e) => {
          if (e.ctrlKey || e.metaKey) { App.selection.fromLayer(L); return; }
          if (!App.busyTool()) App.layers.select(i);
        };
        list.appendChild(row);
      }
      const A = App.activeLayer();
      blend.value = A.blend;
      op.value = Math.round(A.opacity * 100);
      opv.textContent = op.value + '%';
    };
    let tT = 0;
    const refreshThumbs = () => {
      if (tT) return;
      tT = setTimeout(() => { tT = 0; for (const [L, c] of thumbs) drawThumb(L, c); }, 250);
    };
    App.on('layers', render);
    App.on('doc', render);
    App.on('pixels', refreshThumbs);
  }

  function buildHistory() {
    const list = document.getElementById('history-list');
    App.on('history', () => {
      const H = App.history;
      list.innerHTML = '';
      H.stack.forEach((s, i) => {
        list.appendChild(h('div', { class: 'hist' + (i === H.index ? ' active' : '') + (i > H.index ? ' future' : ''), onclick: () => H.jump(i) }, s.label));
      });
      const a = list.querySelector('.active');
      if (a) {
        const top = a.offsetTop - list.offsetTop;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + a.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + a.offsetHeight - list.clientHeight;
      }
    });
  }

  // ---------------------------------------------------------------- stage
  let spaceDown = false, panning = null, pointerDown = false;
  function updateCursor() {
    const c = App.view.canvas; if (!c) return;
    const t = App.tools.current;
    c.style.cursor = panning ? 'grabbing' : spaceDown ? 'grab' : (t ? t.cursor : 'default');
  }

  function buildStage() {
    const c = document.getElementById('view');
    App.view.init(c);
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const coords = document.getElementById('st-pos');

    c.addEventListener('pointerdown', (e) => {
      if (!App.doc || App.ui.modalOpen) return;
      c.setPointerCapture(e.pointerId);
      const s = pos(e);
      const t = App.tools.current;
      if (e.button === 1 || spaceDown || (e.button === 0 && t.id === 'hand')) {
        e.preventDefault();
        panning = { sx: s.x, sy: s.y, px: App.view.panX, py: App.view.panY };
        updateCursor();
        return;
      }
      if (e.button !== 0) return;
      pointerDown = true;
      if (t.down) t.down(e, App.view.toDoc(s.x, s.y), s);
    });
    c.addEventListener('pointermove', (e) => {
      const s = pos(e);
      const p = App.view.toDoc(s.x, s.y);
      App.pointer = p; App.pointerInside = true;
      if (App.doc) coords.textContent = `${Math.floor(p.x)}, ${Math.floor(p.y)}`;
      if (panning) {
        App.view.panX = panning.px + s.x - panning.sx;
        App.view.panY = panning.py + s.y - panning.sy;
        App.requestRender();
        return;
      }
      const t = App.tools.current;
      if (pointerDown && t.move) {
        const evs = (e.getCoalescedEvents && (t.id === 'brush' || t.id === 'eraser')) ? e.getCoalescedEvents() : [e];
        for (const ce of (evs.length ? evs : [e])) { const cs = pos(ce); t.move(ce, App.view.toDoc(cs.x, cs.y), cs); }
      } else if (t.hover) t.hover(e, p, s);
    });
    const end = (e) => {
      if (panning) { panning = null; updateCursor(); return; }
      if (!pointerDown) return;
      pointerDown = false;
      const s = pos(e), t = App.tools.current;
      if (t.up) t.up(e, App.view.toDoc(s.x, s.y), s);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { App.pointerInside = false; App.requestRender(); });
    c.addEventListener('dblclick', () => { if (App.tools.current.id === 'hand') App.view.fit(true); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!App.doc) return;
      const s = pos(e);
      if (e.shiftKey && !e.ctrlKey) {
        App.view.panX -= e.deltaY || e.deltaX;
        App.requestRender();
        return;
      }
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      App.view.setZoom(App.view.zoom * f, s.x, s.y);
    }, { passive: false });

    // drag & drop
    const stage = document.getElementById('stage');
    window.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drop'); });
    window.addEventListener('dragleave', (e) => { if (e.target === document.documentElement || !e.relatedTarget) stage.classList.remove('drop'); });
    window.addEventListener('drop', (e) => {
      e.preventDefault(); stage.classList.remove('drop');
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, 'auto');
    });

    // status bar
    const zoomEl = document.getElementById('st-zoom'), sizeEl = document.getElementById('st-size');
    App.on('view', () => { zoomEl.textContent = Math.round(App.view.zoom * 100) + '%'; });
    App.on('doc', () => { sizeEl.textContent = `${App.doc.width} × ${App.doc.height}px`; zoomEl.textContent = Math.round(App.view.zoom * 100) + '%'; });
    zoomEl.onclick = () => App.view.fit(true);
    const selEl = document.getElementById('st-sel');
    App.on('selection', () => { const b = App.selection.bounds; selEl.textContent = b ? `Selection ${b.w} × ${b.h}` : ''; });
  }

  // ------------------------------------------------------------- keyboard
  function comboOf(e) {
    let k = e.key;
    if (k === ' ') k = 'Space';
    else if (k.length === 1) k = k.toUpperCase();
    return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + k;
  }
  function normalize(sc) {
    // menu labels are written Ctrl+Shift+X / Ctrl+Alt+X; normalize to Ctrl+Alt+Shift+X order
    const parts = sc.split('+');
    let key = parts.pop();
    if (key === '' ) key = '+';
    const mods = new Set(parts.filter(Boolean));
    return (mods.has('Ctrl') ? 'Ctrl+' : '') + (mods.has('Alt') ? 'Alt+' : '') + (mods.has('Shift') ? 'Shift+' : '') + key;
  }

  function buildKeyboard() {
    const map = {};
    for (const [sc, it] of Object.entries(SHORTCUTS)) map[normalize(sc)] = it;

    window.addEventListener('keydown', (e) => {
      if (App.ui.modalOpen) return;
      if (isTyping(e.target)) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); App.gemini.focusPrompt(); }
        return;
      }
      const t = App.tools.current;
      if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; updateCursor(); } return; }
      if (t && t.onKey && !e.ctrlKey && !e.metaKey && !e.altKey && t.onKey(e)) { e.preventDefault(); return; }
      const combo = comboOf(e);
      const it = map[combo];
      if (it) {
        e.preventDefault();
        if (App.busyTool()) return;
        if (it[3] && !it[3]()) return;
        it[2]();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { if (App.selection.has()) App.selection.none(); return; }
      if (k === 'x') { App.swapColors(); return; }
      if (k === 'd') { App.resetColors(); return; }
      if (k === '[' || k === ']') {
        const id = t.id === 'eraser' ? 'eraserSize' : 'brushSize';
        const v = App.opts[id];
        const step = v < 10 ? 1 : v < 50 ? 5 : v < 200 ? 10 : 25;
        App.opts[id] = U.clamp(v + (k === ']' ? step : -step), 1, 500);
        App.emit('opts'); App.requestRender();
        return;
      }
      if (e.key === 'F1') { e.preventDefault(); shortcutsDialog(); return; }
      if (e.shiftKey) return;
      const tool = App.tools.list.find(x => x.key === k);
      if (tool) App.tools.select(tool.id);
    });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') { spaceDown = false; updateCursor(); } });
    window.addEventListener('blur', () => { spaceDown = false; App.clipboardFresh = false; updateCursor(); });

    document.addEventListener('copy', () => { App.clipboardFresh = true; });
    document.addEventListener('paste', (e) => {
      if (isTyping(e.target) || App.ui.modalOpen) return;
      e.preventDefault();
      const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
      if (App.clipboard && (App.clipboardFresh || !files.length)) { App.ops.pasteInternal(); return; }
      if (files.length) handleFiles(files, 'auto');
      else App.toast('Clipboard has no image');
    });
  }

  // ---------------------------------------------------------------- panels
  function buildPanels() {
    document.querySelectorAll('.panel-head').forEach(hd => {
      hd.insertAdjacentHTML('beforeend', `<span class="chev">${svg(ICON.chevron)}</span>`);
      hd.onclick = () => hd.parentElement.classList.toggle('collapsed');
    });
  }

  // ------------------------------------------------------------------ init
  function init() {
    buildMenus();
    buildToolbar();
    buildOptions();
    buildLayers();
    buildHistory();
    buildStage();
    buildKeyboard();
    buildPanels();
    App.gemini.init(document.getElementById('gemini-body'));

    const fi = fileInput();
    fi.onchange = () => { if (fi.files.length) handleFiles(fi.files, fileMode); fi.value = ''; };

    // the Copy menu sets App.clipboardFresh via ops.copy -> mark fresh there too
    const origCopy = App.ops.copy;
    App.ops.copy = async (merged) => { await origCopy(merged); App.clipboardFresh = true; };

    App.tools.select('brush');
    App.newDocument(1200, 800, '#ffffff');
    App.doc.name = 'untitled';

    window.addEventListener('beforeunload', (e) => {
      if (!App.isPristine() && App.history.saved !== App.history.index) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.App);
