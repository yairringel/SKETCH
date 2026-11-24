'use strict';
/* Core: utilities, document model, layers, history, view & rendering */
window.App = window.App || {};
(function (App) {
  // ---------------------------------------------------------------- utils
  const U = App.util = {
    canvas(w, h) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      return c;
    },
    clone(src) {
      const c = U.canvas(src.width, src.height);
      c.getContext('2d').drawImage(src, 0, 0);
      return c;
    },
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    uid: (() => { let n = 1; return () => n++; })(),
    hexToRgb(hex) {
      let h = String(hex).replace('#', '');
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      const n = parseInt(h, 16) || 0;
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    },
    rgbToHex(r, g, b) {
      return '#' + [r, g, b].map(v => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
    },
    loadImage(src) {
      return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('Could not load image'));
        img.src = src;
      });
    },
    async fileToImage(file) {
      const url = URL.createObjectURL(file);
      try { return await U.loadImage(url); }
      finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
    },
    canvasToBlob(c, type, q) { return new Promise(r => c.toBlob(r, type, q)); },
    download(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
    normRect(a, b) {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    },
    /* Scanline flood fill. Returns Uint8Array (1 = in region). */
    floodRegion(data, w, h, x0, y0, tol, contiguous) {
      const out = new Uint8Array(w * h);
      if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return out;
      const i0 = (y0 * w + x0) * 4;
      const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2], a0 = data[i0 + 3];
      const match = (k) => {
        const j = k * 4;
        return Math.abs(data[j] - r0) <= tol && Math.abs(data[j + 1] - g0) <= tol &&
          Math.abs(data[j + 2] - b0) <= tol && Math.abs(data[j + 3] - a0) <= tol;
      };
      if (!contiguous) {
        for (let k = 0; k < w * h; k++) if (match(k)) out[k] = 1;
        return out;
      }
      const stack = [x0, y0];
      while (stack.length) {
        const y = stack.pop(), x = stack.pop();
        const row = y * w;
        if (out[row + x] || !match(row + x)) continue;
        let l = x, r = x;
        while (l > 0 && !out[row + l - 1] && match(row + l - 1)) l--;
        while (r < w - 1 && !out[row + r + 1] && match(row + r + 1)) r++;
        for (let i = l; i <= r; i++) out[row + i] = 1;
        for (const ny of [y - 1, y + 1]) {
          if (ny < 0 || ny >= h) continue;
          const nrow = ny * w;
          let inSpan = false;
          for (let i = l; i <= r; i++) {
            const k = nrow + i;
            if (!out[k] && match(k)) {
              if (!inSpan) { stack.push(i, ny); inSpan = true; }
            } else inSpan = false;
          }
        }
      }
      return out;
    },
    /* Copy `src` onto a canvas padded by p px, extending edge pixels outward (avoids dark/transparent fringes when blurring). */
    padEdges(src, p) {
      const w = src.width, h = src.height;
      const c = U.canvas(w + 2 * p, h + 2 * p);
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.drawImage(src, p, p);
      x.drawImage(src, 0, 0, w, 1, p, 0, w, p);            // top
      x.drawImage(src, 0, h - 1, w, 1, p, p + h, w, p);    // bottom
      x.drawImage(src, 0, 0, 1, h, 0, p, p, h);            // left
      x.drawImage(src, w - 1, 0, 1, h, p + w, p, p, h);    // right
      x.drawImage(src, 0, 0, 1, 1, 0, 0, p, p);
      x.drawImage(src, w - 1, 0, 1, 1, p + w, 0, p, p);
      x.drawImage(src, 0, h - 1, 1, 1, 0, p + h, p, p);
      x.drawImage(src, w - 1, h - 1, 1, 1, p + w, p + h, p, p);
      return c;
    },
  };

  // --------------------------------------------------------------- events
  const listeners = {};
  App.on = (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); };
  App.emit = (name, data) => { (listeners[name] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); };

  // ---------------------------------------------------------------- state
  App.colors = { fg: '#000000', bg: '#ffffff' };
  App.setColor = (which, hex) => { App.colors[which] = hex; App.emit('colors'); };
  App.swapColors = () => { const c = App.colors; [c.fg, c.bg] = [c.bg, c.fg]; App.emit('colors'); };
  App.resetColors = () => { App.colors.fg = '#000000'; App.colors.bg = '#ffffff'; App.emit('colors'); };

  /* Tool options (percent values stored as 0-100). */
  App.opts = {
    brushSize: 20, brushHardness: 80, brushOpacity: 100,
    eraserSize: 40, eraserHardness: 80, eraserOpacity: 100,
    fillTolerance: 32, fillContiguous: true, fillSampleAll: false, fillOpacity: 100,
    wandTolerance: 32, wandContiguous: true, wandSampleAll: false,
    selMode: 'replace', selFeather: 0,
    gradType: 'linear', gradToTransparent: false, gradOpacity: 100,
    shapeType: 'rect', shapeFill: true, strokeWidth: 6, shapeNewLayer: true,
  };

  // --------------------------------------------------------------- layers
  class Layer {
    constructor(w, h, name) {
      this.id = U.uid();
      this.name = name || 'Layer';
      this.canvas = U.canvas(w, h);
      this.ctx = this.canvas.getContext('2d');
      this.visible = true;
      this.opacity = 1;
      this.blend = 'source-over';
      this.rev = 0;
    }
    setCanvas(c) { this.canvas = c; this.ctx = c.getContext('2d'); this.rev++; }
  }
  App.Layer = Layer;

  App.doc = null;
  App.activeLayer = () => App.doc.layers[App.doc.active];

  /** Must be called whenever a layer's pixels change. */
  App.layerChanged = (layer) => {
    if (layer) layer.rev++;
    App.markDirty();
    App.emit('pixels');
  };

  App.setDocument = (doc, label) => {
    App.doc = doc;
    App.selection.set(doc.selMask || null);
    App.history.reset(label || 'Open');
    App.view.fit(false);
    App.markDirty();
    App.emit('layers');
    App.emit('doc');
  };

  App.newDocument = (w, h, bg) => {
    const doc = { width: w, height: h, layers: [], active: 0, selMask: null };
    const L = new Layer(w, h, 'Background');
    if (bg && bg !== 'transparent') { L.ctx.fillStyle = bg; L.ctx.fillRect(0, 0, w, h); }
    doc.layers.push(L);
    App.setDocument(doc, 'New Document');
  };

  App.openImage = (img, name) => {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const doc = { width: w, height: h, layers: [], active: 0, selMask: null };
    const L = new Layer(w, h, name || 'Background');
    L.ctx.drawImage(img, 0, 0);
    doc.layers.push(L);
    App.setDocument(doc, 'Open');
  };

  App.isPristine = () => App.history.stack.length <= 1;

  App.layers = {
    add(name, opts = {}) {
      const d = App.doc;
      const L = new Layer(d.width, d.height, name || `Layer ${d.layers.length}`);
      const idx = opts.index != null ? opts.index : d.active + 1;
      d.layers.splice(idx, 0, L);
      d.active = idx;
      App.markDirty();
      App.emit('layers');
      if (opts.history !== false) App.history.push('New Layer');
      return L;
    },
    duplicate() {
      const d = App.doc, src = App.activeLayer();
      const L = new Layer(d.width, d.height, src.name + ' copy');
      L.ctx.drawImage(src.canvas, 0, 0);
      L.opacity = src.opacity; L.blend = src.blend; L.visible = src.visible;
      d.layers.splice(d.active + 1, 0, L);
      d.active++;
      App.markDirty(); App.emit('layers');
      App.history.push('Duplicate Layer');
    },
    viaCopy(cut) {
      const sel = App.selection.mask;
      if (!sel) return App.layers.duplicate();
      const d = App.doc, src = App.activeLayer();
      const L = new Layer(d.width, d.height, src.name + (cut ? ' cut' : ' copy'));
      L.ctx.drawImage(src.canvas, 0, 0);
      L.ctx.globalCompositeOperation = 'destination-in';
      L.ctx.drawImage(sel, 0, 0);
      L.ctx.globalCompositeOperation = 'source-over';
      if (cut) {
        src.ctx.globalCompositeOperation = 'destination-out';
        src.ctx.drawImage(sel, 0, 0);
        src.ctx.globalCompositeOperation = 'source-over';
        src.rev++;
      }
      d.layers.splice(d.active + 1, 0, L);
      d.active++;
      App.markDirty(); App.emit('layers'); App.emit('pixels');
      App.history.push(cut ? 'Layer via Cut' : 'Layer via Copy');
    },
    remove() {
      const d = App.doc;
      if (d.layers.length <= 1) { App.toast('Cannot delete the only layer'); return; }
      d.layers.splice(d.active, 1);
      d.active = Math.max(0, d.active - 1);
      App.markDirty(); App.emit('layers');
      App.history.push('Delete Layer');
    },
    move(delta) {
      const d = App.doc, i = d.active, j = i + delta;
      if (j < 0 || j >= d.layers.length) return;
      [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
      d.active = j;
      App.markDirty(); App.emit('layers');
      App.history.push('Reorder Layers');
    },
    select(i) {
      App.doc.active = U.clamp(i, 0, App.doc.layers.length - 1);
      App.emit('layers');
    },
    mergeDown() {
      const d = App.doc;
      if (d.active === 0) { App.toast('No layer below to merge into'); return; }
      const up = d.layers[d.active], lo = d.layers[d.active - 1];
      if (up.visible) {
        lo.ctx.globalAlpha = up.opacity;
        lo.ctx.globalCompositeOperation = up.blend;
        lo.ctx.drawImage(up.canvas, 0, 0);
        lo.ctx.globalAlpha = 1;
        lo.ctx.globalCompositeOperation = 'source-over';
        lo.rev++;
      }
      d.layers.splice(d.active, 1);
      d.active--;
      App.markDirty(); App.emit('layers'); App.emit('pixels');
      App.history.push('Merge Down');
    },
    flatten() {
      const d = App.doc;
      const L = new Layer(d.width, d.height, 'Background');
      L.ctx.drawImage(App.getComposite(), 0, 0);
      d.layers = [L];
      d.active = 0;
      App.markDirty(); App.emit('layers');
      App.history.push('Flatten Image');
    },
    setProp(L, prop, value, record) {
      L[prop] = value;
      App.markDirty();
      App.emit('layers');
      if (record) App.history.push(record);
    },
  };

  // ------------------------------------------------------------ composite
  App.composite = U.canvas(1, 1);
  App.compositeDirty = true;
  App.getComposite = () => {
    const d = App.doc, c = App.composite;
    if (!App.compositeDirty && c.width === d.width && c.height === d.height) return c;
    if (c.width !== d.width || c.height !== d.height) { c.width = d.width; c.height = d.height; }
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    for (const L of d.layers) {
      if (!L.visible || L.opacity <= 0) continue;
      x.globalAlpha = L.opacity;
      x.globalCompositeOperation = L.blend;
      x.drawImage(L.canvas, 0, 0);
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    App.compositeDirty = false;
    return c;
  };

  // -------------------------------------------------------------- history
  App.history = {
    stack: [], index: -1, limit: 40,
    snapshot(label) {
      const d = App.doc, prev = this.stack[this.index];
      const prevMap = new Map(prev ? prev.layers.map(l => [l.id, l]) : []);
      return {
        label, width: d.width, height: d.height, active: d.active,
        layers: d.layers.map(L => {
          const p = prevMap.get(L.id);
          const reuse = p && p.rev === L.rev && p.canvas.width === L.canvas.width && p.canvas.height === L.canvas.height;
          return { id: L.id, name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend, rev: L.rev, canvas: reuse ? p.canvas : U.clone(L.canvas) };
        }),
        selRev: App.selection.rev,
        sel: d.selMask ? (prev && prev.selRev === App.selection.rev && prev.sel ? prev.sel : U.clone(d.selMask)) : null,
      };
    },
    reset(label) {
      this.stack = []; this.index = -1;
      this.stack.push(this.snapshot(label)); this.index = 0;
      App.emit('history');
    },
    push(label) {
      this.stack.length = this.index + 1;
      this.stack.push(this.snapshot(label));
      while (this.stack.length > this.limit) this.stack.shift();
      this.index = this.stack.length - 1;
      App.emit('history');
    },
    restore(i) {
      const s = this.stack[i], d = App.doc;
      d.width = s.width; d.height = s.height;
      d.layers = s.layers.map(sl => {
        const L = new Layer(1, 1, sl.name);
        L.id = sl.id; L.visible = sl.visible; L.opacity = sl.opacity; L.blend = sl.blend;
        L.canvas = U.clone(sl.canvas); L.ctx = L.canvas.getContext('2d');
        L.rev = sl.rev;
        return L;
      });
      d.active = Math.min(s.active, d.layers.length - 1);
      App.selection.set(s.sel ? U.clone(s.sel) : null);
      App.markDirty();
      App.emit('layers'); App.emit('doc'); App.emit('history'); App.emit('pixels');
    },
    canUndo() { return this.index > 0; },
    canRedo() { return this.index < this.stack.length - 1; },
    undo() { if (App.busyTool()) return; if (this.canUndo()) { this.index--; this.restore(this.index); } },
    redo() { if (App.busyTool()) return; if (this.canRedo()) { this.index++; this.restore(this.index); } },
    jump(i) { if (App.busyTool()) return; if (i >= 0 && i < this.stack.length && i !== this.index) { this.index = i; this.restore(i); } },
  };
  App.busyTool = () => App.tools && App.tools.current && App.tools.current.busy && App.tools.current.busy();

  // ------------------------------------------------------- pixel helpers
  /** Composite `after` into layer inside the selection only: layer = before*(1-m) + after*m. Mutates `after`. */
  App.composeMasked = (L, before, after, mask) => {
    const m = mask || App.selection.mask;
    const ac = after.getContext('2d');
    ac.globalCompositeOperation = 'destination-in';
    ac.drawImage(m, 0, 0);
    ac.globalCompositeOperation = 'source-over';
    const c = L.ctx;
    c.clearRect(0, 0, L.canvas.width, L.canvas.height);
    c.drawImage(before, 0, 0);
    c.globalCompositeOperation = 'destination-out';
    c.drawImage(m, 0, 0);
    c.globalCompositeOperation = 'lighter';
    c.drawImage(after, 0, 0);
    c.globalCompositeOperation = 'source-over';
  };

  /** Run fn(ctx, w, h) on the active layer, restricted to the selection if any. */
  App.applyToLayer = (L, fn, label) => {
    const w = L.canvas.width, h = L.canvas.height;
    if (App.selection.mask) {
      const before = U.clone(L.canvas);
      const after = U.clone(L.canvas);
      const ac = after.getContext('2d');
      ac.save(); fn(ac, w, h); ac.restore();
      App.composeMasked(L, before, after);
    } else {
      L.ctx.save(); fn(L.ctx, w, h); L.ctx.restore();
    }
    App.layerChanged(L);
    if (label) App.history.push(label);
  };

  /** Replace the layer with `out` (a full-size canvas), restricted to the selection. */
  App.applyResult = (L, before, out) => {
    if (App.selection.mask) App.composeMasked(L, before, out);
    else { L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height); L.ctx.drawImage(out, 0, 0); }
    App.layerChanged(L);
  };

  // ------------------------------------------------------ document ops
  function transformAll(nw, nh, fn, label) {
    const d = App.doc;
    nw = Math.max(1, Math.round(nw)); nh = Math.max(1, Math.round(nh));
    for (const L of d.layers) {
      const c = U.canvas(nw, nh);
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      fn(x, L.canvas);
      L.setCanvas(c);
    }
    let mask = null;
    if (d.selMask) {
      mask = U.canvas(nw, nh);
      const x = mask.getContext('2d');
      x.imageSmoothingQuality = 'high';
      fn(x, d.selMask);
    }
    d.width = nw; d.height = nh;
    App.selection.set(mask);
    App.markDirty();
    App.emit('layers'); App.emit('doc'); App.emit('pixels');
    App.history.push(label);
  }

  App.ops = {
    cropTo(r) {
      const d = App.doc;
      const x0 = U.clamp(Math.round(r.x), 0, d.width), y0 = U.clamp(Math.round(r.y), 0, d.height);
      const x1 = U.clamp(Math.round(r.x + r.w), 0, d.width), y1 = U.clamp(Math.round(r.y + r.h), 0, d.height);
      if (x1 - x0 < 1 || y1 - y0 < 1) return;
      transformAll(x1 - x0, y1 - y0, (ctx, src) => ctx.drawImage(src, -x0, -y0), 'Crop');
      App.view.fit(false);
    },
    cropToSelection() {
      const b = App.selection.bounds;
      if (!b) { App.toast('Make a selection first'); return; }
      App.ops.cropTo(b);
      App.selection.set(null);
    },
    canvasSize(nw, nh, ax, ay) {
      const d = App.doc;
      const ox = Math.round((nw - d.width) * ax), oy = Math.round((nh - d.height) * ay);
      transformAll(nw, nh, (ctx, src) => ctx.drawImage(src, ox, oy), 'Canvas Size');
      App.view.fit(false);
    },
    imageSize(nw, nh) {
      transformAll(nw, nh, (ctx, src) => ctx.drawImage(src, 0, 0, nw, nh), 'Image Size');
      App.view.fit(false);
    },
    rotate(deg) {
      const d = App.doc, w = d.width, h = d.height;
      const swap = deg % 180 !== 0;
      transformAll(swap ? h : w, swap ? w : h, (ctx, src) => {
        if (deg === 90) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
        else if (deg === -90) { ctx.translate(0, w); ctx.rotate(-Math.PI / 2); }
        else { ctx.translate(w, h); ctx.rotate(Math.PI); }
        ctx.drawImage(src, 0, 0);
      }, 'Rotate Canvas');
      App.view.fit(false);
    },
    flip(horizontal) {
      const d = App.doc, w = d.width, h = d.height;
      transformAll(w, h, (ctx, src) => {
        if (horizontal) { ctx.translate(w, 0); ctx.scale(-1, 1); } else { ctx.translate(0, h); ctx.scale(1, -1); }
        ctx.drawImage(src, 0, 0);
      }, horizontal ? 'Flip Horizontal' : 'Flip Vertical');
    },
    flipLayer(horizontal) {
      const L = App.activeLayer(), w = L.canvas.width, h = L.canvas.height;
      const src = U.clone(L.canvas);
      L.ctx.clearRect(0, 0, w, h);
      L.ctx.save();
      if (horizontal) { L.ctx.translate(w, 0); L.ctx.scale(-1, 1); } else { L.ctx.translate(0, h); L.ctx.scale(1, -1); }
      L.ctx.drawImage(src, 0, 0);
      L.ctx.restore();
      App.layerChanged(L);
      App.history.push(horizontal ? 'Flip Layer Horizontal' : 'Flip Layer Vertical');
    },
    clear() {
      const L = App.activeLayer(), sel = App.selection.mask;
      if (sel) {
        L.ctx.globalCompositeOperation = 'destination-out';
        L.ctx.drawImage(sel, 0, 0);
        L.ctx.globalCompositeOperation = 'source-over';
      } else L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
      App.layerChanged(L);
      App.history.push('Clear');
    },
    fill(color) {
      App.applyToLayer(App.activeLayer(), (ctx, w, h) => { ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); }, 'Fill');
    },
    /** Add an image as a new layer, centered, scaled down to fit if larger than the canvas. */
    placeImage(img, name, rect) {
      const d = App.doc;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const L = App.layers.add(name || 'Placed Image', { history: false });
      if (rect) L.ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
      else {
        const s = Math.min(1, d.width / iw, d.height / ih);
        const w = iw * s, h = ih * s;
        L.ctx.imageSmoothingQuality = 'high';
        L.ctx.drawImage(img, Math.round((d.width - w) / 2), Math.round((d.height - h) / 2), w, h);
      }
      App.layerChanged(L);
      App.history.push('Place Image');
      return L;
    },
    async copy(merged) {
      const src = merged ? App.getComposite() : App.activeLayer().canvas;
      const sel = App.selection.mask, b = App.selection.bounds;
      let out;
      if (sel && b) {
        out = U.canvas(b.w, b.h);
        const x = out.getContext('2d');
        x.drawImage(src, -b.x, -b.y);
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(sel, -b.x, -b.y);
      } else out = U.clone(src);
      App.clipboard = out;
      try {
        const blob = await U.canvasToBlob(out, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        App.toast('Copied');
      } catch (e) { App.toast('Copied (internal clipboard)'); }
    },
    async cut() {
      await App.ops.copy(false);
      App.ops.clear();
    },
    pasteInternal() {
      if (!App.clipboard) { App.toast('Clipboard is empty'); return; }
      const c = App.clipboard, b = App.selection.bounds;
      const L = App.layers.add('Pasted', { history: false });
      const x = b ? b.x : Math.round((App.doc.width - c.width) / 2);
      const y = b ? b.y : Math.round((App.doc.height - c.height) / 2);
      L.ctx.drawImage(c, x, y);
      App.layerChanged(L);
      App.history.push('Paste');
    },
  };

  // ------------------------------------------------------- view/render
  const ZOOMS = [0.02, 0.03, 0.05, 0.0667, 0.1, 0.125, 0.1667, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32];
  App.view = {
    zoom: 1, panX: 0, panY: 0, w: 0, h: 0, dpr: 1, canvas: null, ctx: null, checker: null,
    init(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      const p = U.canvas(16, 16), x = p.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
      x.fillStyle = '#d9d9d9'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
      this.checker = this.ctx.createPattern(p, 'repeat');
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(canvas.parentElement);
      this.resize();
    },
    resize() {
      const el = this.canvas.parentElement;
      const r = el.getBoundingClientRect();
      const first = this.w === 0;
      const ocx = this.w / 2, ocy = this.h / 2;
      this.dpr = window.devicePixelRatio || 1;
      this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.canvas.style.width = this.w + 'px';
      this.canvas.style.height = this.h + 'px';
      if (!first) { this.panX += this.w / 2 - ocx; this.panY += this.h / 2 - ocy; }
      App.requestRender();
    },
    toDoc(sx, sy) { return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom }; },
    toScreen(x, y) { return { x: x * this.zoom + this.panX, y: y * this.zoom + this.panY }; },
    fit(allowUpscale = true) {
      const d = App.doc; if (!d || !this.w) return;
      const m = 32;
      let z = Math.min((this.w - 2 * m) / d.width, (this.h - 2 * m) / d.height);
      if (!allowUpscale) z = Math.min(z, 1);
      this.zoom = U.clamp(z, 0.02, 32);
      this.center();
    },
    center() {
      const d = App.doc;
      this.panX = Math.round((this.w - d.width * this.zoom) / 2);
      this.panY = Math.round((this.h - d.height * this.zoom) / 2);
      App.requestRender(); App.emit('view');
    },
    actual() { this.zoom = 1; this.center(); },
    setZoom(z, cx, cy) {
      if (cx == null) { cx = this.w / 2; cy = this.h / 2; }
      const p = this.toDoc(cx, cy);
      this.zoom = U.clamp(z, 0.02, 32);
      this.panX = cx - p.x * this.zoom;
      this.panY = cy - p.y * this.zoom;
      App.requestRender(); App.emit('view');
    },
    step(dir, cx, cy) {
      const z = this.zoom;
      const next = dir > 0 ? ZOOMS.find(v => v > z * 1.01) : [...ZOOMS].reverse().find(v => v < z / 1.01);
      if (next) this.setZoom(next, cx, cy);
    },
  };

  let raf = 0;
  App.antPhase = 0;
  App.markDirty = () => { App.compositeDirty = true; App.requestRender(); };
  App.requestRender = () => { if (!raf) raf = requestAnimationFrame(App.render); };
  App.render = () => {
    raf = 0;
    const v = App.view, ctx = v.ctx, d = App.doc;
    if (!ctx) return;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#1a1b1e';
    ctx.fillRect(0, 0, v.w, v.h);
    if (!d) return;
    const comp = App.getComposite();
    const x = v.panX, y = v.panY, w = d.width * v.zoom, h = d.height * v.zoom;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);
    ctx.restore();
    if (v.checker.setTransform) v.checker.setTransform(new DOMMatrix().translate(x, y));
    ctx.fillStyle = v.checker; ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.translate(x, y); ctx.scale(v.zoom, v.zoom);
    ctx.imageSmoothingEnabled = v.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(comp, 0, 0);
    ctx.restore();
    if (App.gemini && App.gemini.drawOverlay) App.gemini.drawOverlay(ctx);
    App.selection.drawOutline(ctx);
    const t = App.tools && App.tools.current;
    if (t && t.overlay) { ctx.save(); t.overlay(ctx); ctx.restore(); }
  };

  setInterval(() => {
    if (App.doc && (App.selection.path || (App.gemini && App.gemini.busy))) {
      App.antPhase = (App.antPhase + 1) % 1000;
      App.requestRender();
    }
  }, 90);

  // ---------------------------------------------------------------- toast
  App.toast = (msg, type) => {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'show' + (type ? ' ' + type : '');
    clearTimeout(App.toast._t);
    App.toast._t = setTimeout(() => { el.className = ''; }, type === 'error' ? 6000 : 2400);
  };
})(window.App);
