'use strict';
/* Selection: an alpha mask canvas (doc-sized) + marching-ants outline */
(function (App) {
  const U = App.util;

  function analyze(mask) {
    const w = mask.width, h = mask.height;
    const data = mask.getContext('2d').getImageData(0, 0, w, h).data;
    const sel = new Uint8Array(w * h);
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const a = data[(row + x) * 4 + 3];
        if (a > 0) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (a >= 128) sel[row + x] = 1;
        }
      }
    }
    if (maxX < 0) return null;
    const get = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? sel[y * w + x] : 0;
    const path = new Path2D();
    // horizontal edges
    for (let y = minY; y <= maxY + 1; y++) {
      let run = -1;
      for (let x = minX; x <= maxX + 1; x++) {
        const edge = get(x, y - 1) !== get(x, y);
        if (edge && run < 0) run = x;
        else if (!edge && run >= 0) { path.moveTo(run, y); path.lineTo(x, y); run = -1; }
      }
    }
    // vertical edges
    for (let x = minX; x <= maxX + 1; x++) {
      let run = -1;
      for (let y = minY; y <= maxY + 1; y++) {
        const edge = get(x - 1, y) !== get(x, y);
        if (edge && run < 0) run = y;
        else if (!edge && run >= 0) { path.moveTo(x, run); path.lineTo(x, y); run = -1; }
      }
    }
    return { bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, path };
  }

  const S = App.selection = {
    rev: 0, bounds: null, path: null, offset: null,
    get mask() { return App.doc ? App.doc.selMask : null; },
    has() { return !!this.mask; },

    set(mask) {
      this.rev++;
      let info = null;
      if (mask) { info = analyze(mask); if (!info) mask = null; }
      if (App.doc) App.doc.selMask = mask;
      this.bounds = info ? info.bounds : null;
      this.path = info ? info.path : null;
      this.offset = null;
      App.emit('selection');
      App.requestRender();
    },

    blank() { return U.canvas(App.doc.width, App.doc.height); },

    shape(drawFn) {
      const c = this.blank(), x = c.getContext('2d');
      x.fillStyle = '#fff';
      drawFn(x);
      return c;
    },

    feathered(shape, r) {
      if (!r || r <= 0) return shape;
      const c = this.blank(), x = c.getContext('2d');
      x.filter = `blur(${r}px)`;
      x.drawImage(shape, 0, 0);
      return c;
    },

    combine(shape, mode) {
      const cur = this.mask;
      let m;
      if (mode === 'replace' || (!cur && mode === 'add')) m = shape;
      else if (!cur) m = null;
      else {
        m = U.clone(cur);
        const c = m.getContext('2d');
        c.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
        c.drawImage(shape, 0, 0);
      }
      this.set(m);
    },

    all() {
      this.set(this.shape(x => x.fillRect(0, 0, App.doc.width, App.doc.height)));
      App.history.push('Select All');
    },
    none() {
      if (!this.mask) return;
      this.set(null);
      App.history.push('Deselect');
    },
    invert() {
      const cur = this.mask;
      const m = this.shape(x => x.fillRect(0, 0, App.doc.width, App.doc.height));
      if (cur) {
        const c = m.getContext('2d');
        c.globalCompositeOperation = 'destination-out';
        c.drawImage(cur, 0, 0);
      }
      this.set(m);
      App.history.push('Inverse');
    },
    feather(r) {
      if (!this.mask) { App.toast('Nothing selected'); return; }
      this.set(this.feathered(this.mask, r));
      App.history.push('Feather');
    },
    /** Expand (r>0) or contract (r<0) the selection by blurring and thresholding. */
    grow(r) {
      if (!this.mask || !r) return;
      const w = App.doc.width, h = App.doc.height;
      const pad = Math.ceil(Math.abs(r)) + 2;
      const c = U.canvas(w + pad * 2, h + pad * 2), x = c.getContext('2d');
      x.filter = `blur(${Math.abs(r) / 2}px)`;
      x.drawImage(this.mask, pad, pad);
      const id = x.getImageData(pad, pad, w, h), d = id.data;
      const t = r > 0 ? 8 : 247;
      for (let i = 3; i < d.length; i += 4) {
        const on = d[i] >= t;
        d[i - 3] = d[i - 2] = d[i - 1] = 255;
        d[i] = on ? 255 : 0;
      }
      const m = this.blank();
      m.getContext('2d').putImageData(id, 0, 0);
      this.set(m);
      App.history.push(r > 0 ? 'Expand Selection' : 'Contract Selection');
    },
    fromLayer(L) {
      const m = this.blank();
      m.getContext('2d').drawImage((L || App.activeLayer()).canvas, 0, 0);
      const c = m.getContext('2d');
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = '#fff';
      c.fillRect(0, 0, m.width, m.height);
      this.set(m);
      App.history.push('Load Selection');
    },
    wand(px, py, tol, contiguous, sampleAll, mode) {
      const d = App.doc;
      const x = Math.floor(px), y = Math.floor(py);
      if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
      const src = sampleAll ? App.getComposite() : App.activeLayer().canvas;
      const data = src.getContext('2d').getImageData(0, 0, d.width, d.height).data;
      const region = U.floodRegion(data, d.width, d.height, x, y, tol, contiguous);
      const id = new ImageData(d.width, d.height), o = id.data;
      for (let i = 0; i < region.length; i++) {
        if (region[i]) { const j = i * 4; o[j] = o[j + 1] = o[j + 2] = o[j + 3] = 255; }
      }
      const shape = this.blank();
      shape.getContext('2d').putImageData(id, 0, 0);
      this.combine(this.feathered(shape, App.opts.selFeather), mode);
      App.history.push('Magic Wand');
    },

    drawOutline(ctx) {
      if (!this.path) return;
      const v = App.view;
      ctx.save();
      ctx.translate(v.panX, v.panY);
      ctx.scale(v.zoom, v.zoom);
      if (this.offset) ctx.translate(this.offset.dx, this.offset.dy);
      ctx.lineWidth = 1 / v.zoom;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke(this.path);
      ctx.strokeStyle = '#000000';
      ctx.setLineDash([4 / v.zoom, 4 / v.zoom]);
      ctx.lineDashOffset = -App.antPhase / v.zoom;
      ctx.stroke(this.path);
      ctx.restore();
    },
  };

  /** Selection mode from modifier keys (Shift = add, Alt = subtract, both = intersect). */
  S.modeFromEvent = (e) => {
    if (e.shiftKey && e.altKey) return 'intersect';
    if (e.shiftKey) return 'add';
    if (e.altKey) return 'subtract';
    return App.opts.selMode;
  };
})(window.App);
