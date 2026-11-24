'use strict';
/* Tools: each tool handles pointer events in document coordinates */
(function (App) {
  const U = App.util;
  const O = App.opts;
  const sel = () => App.selection;

  const ICONS = {
    move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
    rect: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2.5"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7.5" stroke-dasharray="3 2.5"/>',
    lasso: '<path d="M7 19.5C4 18 2 15.3 2 12.2 2 7.1 6.5 3 12 3s10 4.1 10 9.2-4.5 9.2-10 9.2c-1.3 0-2.6-.2-3.7-.6"/><circle cx="6" cy="18" r="2"/><path d="M6 20c0 1.5-1 2-2 2"/>',
    wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
    eyedropper: '<path d="M2 22l1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4z"/>',
    brush: '<path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
    eraser: '<path d="M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9"/>',
    fill: '<path d="M19 11l-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11zM5 2l5 5M2 13h15M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4z"/>',
    gradient: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l12-12M3 21L21 3M9 21l12-12"/>',
    shape: '<rect x="3" y="3" width="11" height="11" rx="1"/><circle cx="16" cy="16" r="5.5"/>',
    text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    zoom: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/>',
  };
  App.ICONS = ICONS;

  const screenRect = (r) => {
    const v = App.view;
    return { x: r.x * v.zoom + v.panX, y: r.y * v.zoom + v.panY, w: r.w * v.zoom, h: r.h * v.zoom };
  };
  const dashed = (ctx) => {
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff'; ctx.setLineDash([]);
    ctx.stroke();
    ctx.strokeStyle = '#000'; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -App.antPhase;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const SEL_MODE = {
    type: 'seg', key: 'selMode', label: 'Mode', options: [
      ['replace', 'New', 'New selection'], ['add', 'Add', 'Add to selection (Shift)'],
      ['subtract', 'Subtract', 'Subtract from selection (Alt)'], ['intersect', 'Intersect', 'Intersect (Shift+Alt)']],
  };
  const FEATHER = { type: 'range', key: 'selFeather', label: 'Feather', min: 0, max: 100, unit: 'px' };

  // ------------------------------------------------------------ painting
  function makeTip(size, hardness, color) {
    const r = Math.max(0.5, size / 2);
    const d = Math.ceil(size) + 2;
    const c = U.canvas(d, d), x = c.getContext('2d');
    const cx = d / 2;
    if (hardness >= 0.99 || size < 3) {
      x.fillStyle = color;
      x.beginPath(); x.arc(cx, cx, r, 0, Math.PI * 2); x.fill();
    } else {
      const { r: R, g: G, b: B } = U.hexToRgb(color);
      const gr = x.createRadialGradient(cx, cx, 0, cx, cx, r);
      gr.addColorStop(0, `rgba(${R},${G},${B},1)`);
      gr.addColorStop(Math.max(0.01, hardness), `rgba(${R},${G},${B},1)`);
      gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
      x.fillStyle = gr; x.fillRect(0, 0, d, d);
    }
    return c;
  }

  function paintTool(erase) {
    const k = erase ? 'eraser' : 'brush';
    return {
      id: k, name: erase ? 'Eraser' : 'Brush', key: erase ? 'e' : 'b', icon: ICONS[k], cursor: 'none',
      options: [
        { type: 'range', key: k + 'Size', label: 'Size', min: 1, max: 500, unit: 'px' },
        { type: 'range', key: k + 'Hardness', label: 'Hardness', min: 0, max: 100, unit: '%' },
        { type: 'range', key: k + 'Opacity', label: 'Opacity', min: 1, max: 100, unit: '%' },
        { type: 'info', text: erase ? '[ ] size · Shift+click: straight line' : '[ ] size · Alt+click: pick color · Shift+click: straight line' },
      ],
      lastPoint: null,
      busy() { return !!this.L; },
      down(e, p) {
        if (!erase && e.altKey) { App.tools.byId.eyedropper.down(e, p); return; }
        const L = App.activeLayer();
        if (!L.visible) App.toast('Painting on a hidden layer');
        this.L = L;
        this.before = U.clone(L.canvas);
        this.stroke = U.canvas(L.canvas.width, L.canvas.height);
        this.sctx = this.stroke.getContext('2d');
        this.tmp = sel().mask ? U.canvas(L.canvas.width, L.canvas.height) : null;
        this.size = O[k + 'Size'];
        this.step = Math.max(0.5, this.size * 0.1);
        this.tip = makeTip(this.size, O[k + 'Hardness'] / 100, erase ? '#000000' : App.colors.fg);
        this.opacity = O[k + 'Opacity'] / 100;
        this.last = null;
        if (e.shiftKey && this.lastPoint) { this.to(this.lastPoint.x, this.lastPoint.y); }
        this.to(p.x, p.y);
      },
      move(e, p) { if (this.L) this.to(p.x, p.y); else App.requestRender(); },
      hover() { App.requestRender(); },
      up() {
        if (!this.L) return;
        cancelAnimationFrame(this.raf); this.raf = 0;
        this.refresh();
        this.lastPoint = this.last;
        this.L = null; this.before = this.stroke = this.tmp = null;
        App.history.push(erase ? 'Eraser' : 'Brush');
      },
      stamp(x, y) {
        const t = this.tip;
        this.sctx.drawImage(t, x - t.width / 2, y - t.height / 2);
      },
      to(x, y) {
        if (!this.last) { this.stamp(x, y); this.last = { x, y }; }
        else {
          const lx = this.last.x, ly = this.last.y, dx = x - lx, dy = y - ly;
          const dist = Math.hypot(dx, dy);
          const n = Math.floor(dist / this.step);
          for (let i = 1; i <= n; i++) this.stamp(lx + dx * i * this.step / dist, ly + dy * i * this.step / dist);
          if (n > 0) this.last = { x: lx + dx * n * this.step / dist, y: ly + dy * n * this.step / dist };
        }
        if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.L) this.refresh(); });
      },
      refresh() {
        const L = this.L, c = L.ctx, w = L.canvas.width, h = L.canvas.height;
        c.clearRect(0, 0, w, h);
        c.drawImage(this.before, 0, 0);
        let s = this.stroke;
        if (this.tmp) {
          const t = this.tmp.getContext('2d');
          t.clearRect(0, 0, w, h);
          t.drawImage(this.stroke, 0, 0);
          t.globalCompositeOperation = 'destination-in';
          t.drawImage(sel().mask, 0, 0);
          t.globalCompositeOperation = 'source-over';
          s = this.tmp;
        }
        c.globalAlpha = this.opacity;
        c.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        c.drawImage(s, 0, 0);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'source-over';
        App.layerChanged(L);
      },
      overlay(ctx) {
        const p = App.pointer; if (!p || !App.pointerInside) return;
        const v = App.view, s = v.toScreen(p.x, p.y);
        const r = Math.max(1, O[k + 'Size'] * v.zoom / 2);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.stroke();
        ctx.beginPath(); ctx.arc(s.x, s.y, r + 1, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.stroke();
        if (r < 4) {
          ctx.beginPath(); ctx.moveTo(s.x - 6, s.y); ctx.lineTo(s.x + 6, s.y); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x, s.y + 6);
          ctx.strokeStyle = '#fff'; ctx.stroke();
        }
      },
    };
  }

  // --------------------------------------------------------------- tools
  const tools = [];

  // Move ---------------------------------------------------------------
  tools.push({
    id: 'move', name: 'Move', key: 'v', icon: ICONS.move, cursor: 'move',
    options: [{ type: 'info', text: 'Drag to move the layer — or only the selected pixels if there is a selection. Arrow keys nudge (Shift = 10px).' }],
    busy() { return !!this.L; },
    down(e, p) {
      const L = App.activeLayer();
      this.L = L; this.start = p; this.dx = 0; this.dy = 0;
      const m = sel().mask;
      this.selMask = m;
      this.float = U.clone(L.canvas);
      if (m) {
        const f = this.float.getContext('2d');
        f.globalCompositeOperation = 'destination-in'; f.drawImage(m, 0, 0);
        this.base = U.clone(L.canvas);
        const b = this.base.getContext('2d');
        b.globalCompositeOperation = 'destination-out'; b.drawImage(m, 0, 0);
      } else this.base = null;
    },
    move(e, p) {
      if (!this.L) return;
      this.dx = Math.round(p.x - this.start.x);
      this.dy = Math.round(p.y - this.start.y);
      if (this.selMask) sel().offset = { dx: this.dx, dy: this.dy };
      if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.L) this.refresh(); });
    },
    refresh() {
      const L = this.L, c = L.ctx;
      c.clearRect(0, 0, L.canvas.width, L.canvas.height);
      if (this.base) c.drawImage(this.base, 0, 0);
      c.drawImage(this.float, this.dx, this.dy);
      App.layerChanged(L);
    },
    up() {
      if (!this.L) return;
      cancelAnimationFrame(this.raf); this.raf = 0;
      this.refresh();
      if (this.selMask) {
        const m = sel().blank();
        m.getContext('2d').drawImage(this.selMask, this.dx, this.dy);
        sel().set(m);
      }
      const moved = this.dx || this.dy;
      this.L = this.float = this.base = this.selMask = null;
      if (moved) App.history.push('Move');
    },
    onKey(e) {
      const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const m = map[e.key]; if (!m) return false;
      const s = e.shiftKey ? 10 : 1;
      this.down(e, { x: 0, y: 0 });
      this.move(e, { x: m[0] * s, y: m[1] * s });
      this.up();
      return true;
    },
  });

  // Marquee (rect / ellipse) ------------------------------------------
  function marquee(id, name, key, ellipse) {
    return {
      id, name, key, icon: ICONS[id], cursor: 'crosshair', options: [SEL_MODE, FEATHER],
      busy() { return !!this.start; },
      down(e, p) { this.mode = sel().modeFromEvent(e); this.start = { x: Math.round(p.x), y: Math.round(p.y) }; this.cur = this.start; },
      move(e, p) {
        if (!this.start) return;
        let c = { x: Math.round(p.x), y: Math.round(p.y) };
        if (e.shiftKey && this.mode !== 'add') {
          const s = Math.max(Math.abs(c.x - this.start.x), Math.abs(c.y - this.start.y));
          c = { x: this.start.x + Math.sign(c.x - this.start.x || 1) * s, y: this.start.y + Math.sign(c.y - this.start.y || 1) * s };
        }
        this.cur = c; App.requestRender();
      },
      up() {
        if (!this.start) return;
        const r = U.normRect(this.start, this.cur);
        this.start = null;
        if (r.w < 1 || r.h < 1) {
          if (this.mode === 'replace' && sel().has()) sel().none();
          App.requestRender();
          return;
        }
        const shape = sel().shape(x => {
          if (ellipse) { x.beginPath(); x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); x.fill(); }
          else x.fillRect(r.x, r.y, r.w, r.h);
        });
        sel().combine(sel().feathered(shape, O.selFeather), this.mode);
        App.history.push(name);
      },
      overlay(ctx) {
        if (!this.start) return;
        const r = screenRect(U.normRect(this.start, this.cur));
        ctx.beginPath();
        if (ellipse) ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        else ctx.rect(r.x + 0.5, r.y + 0.5, r.w, r.h);
        dashed(ctx);
      },
    };
  }
  tools.push(marquee('rect', 'Rectangular Marquee', 'm', false));
  tools.push(marquee('ellipse', 'Elliptical Marquee', 'o', true));

  // Lasso --------------------------------------------------------------
  tools.push({
    id: 'lasso', name: 'Lasso', key: 'l', icon: ICONS.lasso, cursor: 'crosshair', options: [SEL_MODE, FEATHER],
    busy() { return !!this.pts; },
    down(e, p) { this.mode = sel().modeFromEvent(e); this.pts = [p]; },
    move(e, p) {
      if (!this.pts) return;
      const l = this.pts[this.pts.length - 1];
      if (Math.hypot(p.x - l.x, p.y - l.y) * App.view.zoom > 2) { this.pts.push(p); App.requestRender(); }
    },
    up() {
      const pts = this.pts; this.pts = null;
      if (!pts) return;
      if (pts.length < 3) {
        if (this.mode === 'replace' && sel().has()) sel().none();
        App.requestRender(); return;
      }
      const shape = sel().shape(x => {
        x.beginPath(); x.moveTo(pts[0].x, pts[0].y);
        for (const q of pts) x.lineTo(q.x, q.y);
        x.closePath(); x.fill();
      });
      sel().combine(sel().feathered(shape, O.selFeather), this.mode);
      App.history.push('Lasso');
    },
    overlay(ctx) {
      if (!this.pts) return;
      const v = App.view;
      ctx.beginPath();
      this.pts.forEach((q, i) => { const s = v.toScreen(q.x, q.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      dashed(ctx);
    },
  });

  // Magic wand ---------------------------------------------------------
  tools.push({
    id: 'wand', name: 'Magic Wand', key: 'w', icon: ICONS.wand, cursor: 'crosshair',
    options: [SEL_MODE,
      { type: 'range', key: 'wandTolerance', label: 'Tolerance', min: 0, max: 255 },
      { type: 'check', key: 'wandContiguous', label: 'Contiguous' },
      { type: 'check', key: 'wandSampleAll', label: 'Sample all layers' }, FEATHER],
    down(e, p) { sel().wand(p.x, p.y, O.wandTolerance, O.wandContiguous, O.wandSampleAll, sel().modeFromEvent(e)); },
  });

  // Crop ---------------------------------------------------------------
  tools.push({
    id: 'crop', name: 'Crop', key: 'c', icon: ICONS.crop, cursor: 'crosshair',
    options: [
      { type: 'info', text: 'Drag a crop box, drag inside it to move. Enter = apply, Esc = cancel.' },
      { type: 'button', label: 'Apply', primary: true, action: () => App.tools.byId.crop.apply() },
      { type: 'button', label: 'Cancel', action: () => App.tools.byId.crop.cancel() },
      { type: 'button', label: 'Crop to Selection', action: () => App.ops.cropToSelection() },
    ],
    rect: null,
    busy() { return !!this.drag; },
    clampRect(r) {
      const d = App.doc;
      const x0 = U.clamp(r.x, 0, d.width), y0 = U.clamp(r.y, 0, d.height);
      const x1 = U.clamp(r.x + r.w, 0, d.width), y1 = U.clamp(r.y + r.h, 0, d.height);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
    down(e, p) {
      const r = this.rect;
      if (r && p.x > r.x && p.y > r.y && p.x < r.x + r.w && p.y < r.y + r.h) this.drag = { mode: 'move', start: p, orig: { ...r } };
      else { this.drag = { mode: 'new', start: { x: Math.round(p.x), y: Math.round(p.y) } }; this.rect = null; }
    },
    move(e, p) {
      const g = this.drag; if (!g) return;
      if (g.mode === 'move') {
        const d = App.doc;
        this.rect = { ...g.orig, x: U.clamp(Math.round(g.orig.x + p.x - g.start.x), 0, d.width - g.orig.w), y: U.clamp(Math.round(g.orig.y + p.y - g.start.y), 0, d.height - g.orig.h) };
      } else this.rect = this.clampRect(U.normRect(g.start, { x: Math.round(p.x), y: Math.round(p.y) }));
      App.requestRender();
    },
    up() { this.drag = null; if (this.rect && (this.rect.w < 2 || this.rect.h < 2)) this.rect = null; App.requestRender(); },
    apply() { if (this.rect) { App.ops.cropTo(this.rect); this.rect = null; App.requestRender(); } },
    cancel() { this.rect = null; App.requestRender(); },
    deactivate() { this.rect = null; },
    onKey(e) {
      if (e.key === 'Enter') { this.apply(); return true; }
      if (e.key === 'Escape' && this.rect) { this.cancel(); return true; }
      return false;
    },
    overlay(ctx) {
      if (!this.rect) return;
      const v = App.view, d = App.doc;
      const full = screenRect({ x: 0, y: 0, w: d.width, h: d.height });
      const r = screenRect(this.rect);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath(); ctx.rect(full.x, full.y, full.w, full.h); ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(r.x + r.w * i / 3, r.y); ctx.lineTo(r.x + r.w * i / 3, r.y + r.h);
        ctx.moveTo(r.x, r.y + r.h * i / 3); ctx.lineTo(r.x + r.w, r.y + r.h * i / 3);
      }
      ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#fff'; ctx.font = '12px system-ui';
      ctx.fillText(`${Math.round(this.rect.w)} × ${Math.round(this.rect.h)}`, r.x + 4, r.y - 6);
      void v;
    },
  });

  // Eyedropper ---------------------------------------------------------
  tools.push({
    id: 'eyedropper', name: 'Eyedropper', key: 'i', icon: ICONS.eyedropper, cursor: 'crosshair',
    options: [{ type: 'info', text: 'Click to pick the foreground color (Alt+click = background).' }],
    down(e, p) { this.pick(e, p); },
    move(e, p) { this.pick(e, p); },
    pick(e, p) {
      const d = App.doc, x = Math.floor(p.x), y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
      const px = App.getComposite().getContext('2d').getImageData(x, y, 1, 1).data;
      if (px[3] === 0) return;
      const hex = U.rgbToHex(px[0], px[1], px[2]);
      const which = (e.altKey && App.tools.current.id === 'eyedropper') ? 'bg' : 'fg';
      App.setColor(which, hex);
    },
  });

  tools.push(paintTool(false));
  tools.push(paintTool(true));

  // Paint bucket -------------------------------------------------------
  tools.push({
    id: 'fill', name: 'Paint Bucket', key: 'g', icon: ICONS.fill, cursor: 'crosshair',
    options: [
      { type: 'range', key: 'fillTolerance', label: 'Tolerance', min: 0, max: 255 },
      { type: 'range', key: 'fillOpacity', label: 'Opacity', min: 1, max: 100, unit: '%' },
      { type: 'check', key: 'fillContiguous', label: 'Contiguous' },
      { type: 'check', key: 'fillSampleAll', label: 'Sample all layers' },
    ],
    down(e, p) {
      const d = App.doc, w = d.width, h = d.height;
      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const L = App.activeLayer();
      const src = O.fillSampleAll ? App.getComposite() : L.canvas;
      const data = src.getContext('2d').getImageData(0, 0, w, h).data;
      const region = U.floodRegion(data, w, h, x, y, O.fillTolerance, O.fillContiguous);
      const m = sel().mask ? sel().mask.getContext('2d').getImageData(0, 0, w, h).data : null;
      const { r, g, b } = U.hexToRgb(App.colors.fg);
      const op = O.fillOpacity / 100;
      const id = new ImageData(w, h), o = id.data;
      for (let i = 0; i < region.length; i++) {
        if (!region[i]) continue;
        const a = m ? m[i * 4 + 3] : 255;
        if (!a) continue;
        const j = i * 4;
        o[j] = r; o[j + 1] = g; o[j + 2] = b; o[j + 3] = a * op;
      }
      const t = U.canvas(w, h);
      t.getContext('2d').putImageData(id, 0, 0);
      L.ctx.drawImage(t, 0, 0);
      App.layerChanged(L);
      App.history.push('Paint Bucket');
    },
  });

  // Gradient -----------------------------------------------------------
  tools.push({
    id: 'gradient', name: 'Gradient', key: 'n', icon: ICONS.gradient, cursor: 'crosshair',
    options: [
      { type: 'seg', key: 'gradType', label: 'Type', options: [['linear', 'Linear'], ['radial', 'Radial']] },
      { type: 'check', key: 'gradToTransparent', label: 'Foreground → transparent' },
      { type: 'range', key: 'gradOpacity', label: 'Opacity', min: 1, max: 100, unit: '%' },
    ],
    busy() { return !!this.start; },
    down(e, p) { this.start = p; this.end = p; },
    move(e, p) { if (this.start) { this.end = p; App.requestRender(); } },
    up() {
      const s = this.start, en = this.end; this.start = null;
      if (!s || Math.hypot(en.x - s.x, en.y - s.y) < 1) { App.requestRender(); return; }
      const fg = App.colors.fg;
      const { r, g, b } = U.hexToRgb(fg);
      const end = O.gradToTransparent ? `rgba(${r},${g},${b},0)` : App.colors.bg;
      App.applyToLayer(App.activeLayer(), (ctx, w, h) => {
        const gr = O.gradType === 'radial'
          ? ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, Math.hypot(en.x - s.x, en.y - s.y))
          : ctx.createLinearGradient(s.x, s.y, en.x, en.y);
        gr.addColorStop(0, fg); gr.addColorStop(1, end);
        ctx.globalAlpha = O.gradOpacity / 100;
        ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      }, 'Gradient');
    },
    overlay(ctx) {
      if (!this.start) return;
      const v = App.view, a = v.toScreen(this.start.x, this.start.y), b = v.toScreen(this.end.x, this.end.y);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      for (const q of [a, b]) { ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
    },
  });

  // Shapes -------------------------------------------------------------
  function shapePath(ctx, s, e, type) {
    ctx.beginPath();
    if (type === 'line') { ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); return; }
    const r = U.normRect(s, e);
    if (type === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.5, r.w / 2), Math.max(0.5, r.h / 2), 0, 0, Math.PI * 2);
    else ctx.rect(r.x, r.y, r.w, r.h);
  }
  tools.push({
    id: 'shape', name: 'Shape', key: 'u', icon: ICONS.shape, cursor: 'crosshair',
    options: [
      { type: 'seg', key: 'shapeType', label: 'Shape', options: [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line']] },
      { type: 'check', key: 'shapeFill', label: 'Filled' },
      { type: 'range', key: 'strokeWidth', label: 'Stroke', min: 1, max: 100, unit: 'px' },
      { type: 'check', key: 'shapeNewLayer', label: 'New layer' },
      { type: 'info', text: 'Shift = square / circle / 45°' },
    ],
    busy() { return !!this.start; },
    down(e, p) { this.start = p; this.end = p; },
    move(e, p) {
      if (!this.start) return;
      let q = p;
      if (e.shiftKey) {
        const dx = p.x - this.start.x, dy = p.y - this.start.y;
        if (O.shapeType === 'line') {
          const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
          q = { x: this.start.x + Math.cos(a) * len, y: this.start.y + Math.sin(a) * len };
        } else {
          const s = Math.max(Math.abs(dx), Math.abs(dy));
          q = { x: this.start.x + Math.sign(dx || 1) * s, y: this.start.y + Math.sign(dy || 1) * s };
        }
      }
      this.end = q; App.requestRender();
    },
    up() {
      const s = this.start, en = this.end; this.start = null;
      if (!s || Math.hypot(en.x - s.x, en.y - s.y) < 1) { App.requestRender(); return; }
      const type = O.shapeType;
      const L = O.shapeNewLayer ? App.layers.add({ rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' }[type], { history: false }) : App.activeLayer();
      App.applyToLayer(L, (ctx) => {
        ctx.fillStyle = ctx.strokeStyle = App.colors.fg;
        ctx.lineWidth = O.strokeWidth; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        shapePath(ctx, s, en, type);
        if (type !== 'line' && O.shapeFill) ctx.fill(); else ctx.stroke();
      }, 'Shape');
    },
    overlay(ctx) {
      if (!this.start) return;
      const v = App.view;
      ctx.translate(v.panX, v.panY); ctx.scale(v.zoom, v.zoom);
      ctx.fillStyle = ctx.strokeStyle = App.colors.fg;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = O.strokeWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      shapePath(ctx, this.start, this.end, O.shapeType);
      if (O.shapeType !== 'line' && O.shapeFill) ctx.fill(); else ctx.stroke();
    },
  });

  // Text ---------------------------------------------------------------
  tools.push({
    id: 'text', name: 'Text', key: 't', icon: ICONS.text, cursor: 'text',
    options: [{ type: 'info', text: 'Click on the canvas to add text (creates a new layer). Move it afterwards with the Move tool.' }],
    down(e, p) { App.ui.textDialog(p); },
  });

  // Hand / Zoom --------------------------------------------------------
  tools.push({
    id: 'hand', name: 'Hand', key: 'h', icon: ICONS.hand, cursor: 'grab',
    options: [{ type: 'info', text: 'Drag to pan. Tip: hold Space with any tool. Double-click to fit.' },
      { type: 'button', label: 'Fit on Screen', action: () => App.view.fit(true) },
      { type: 'button', label: '100%', action: () => App.view.actual() }],
  });
  tools.push({
    id: 'zoom', name: 'Zoom', key: 'z', icon: ICONS.zoom, cursor: 'zoom-in',
    options: [{ type: 'info', text: 'Click to zoom in, Alt+click to zoom out. Mouse wheel zooms with any tool.' },
      { type: 'button', label: 'Fit on Screen', action: () => App.view.fit(true) },
      { type: 'button', label: '100%', action: () => App.view.actual() }],
    down(e, p, s) { App.view.step(e.altKey ? -1 : 1, s.x, s.y); },
  });

  // ------------------------------------------------------------ registry
  App.tools = {
    list: tools,
    byId: Object.fromEntries(tools.map(t => [t.id, t])),
    current: null,
    select(id) {
      const t = this.byId[id]; if (!t || t === this.current) return;
      if (this.current && this.current.busy && this.current.busy()) return;
      if (this.current && this.current.deactivate) this.current.deactivate();
      this.current = t;
      if (t.activate) t.activate();
      App.emit('tool', t);
      App.requestRender();
    },
  };
})(window.App);
