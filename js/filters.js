'use strict';
/* Adjustments & filters. Every filter maps a source canvas -> new canvas; results respect the selection. */
(function (App) {
  const U = App.util;

  const css = (src, filter) => {
    const c = U.canvas(src.width, src.height), x = c.getContext('2d');
    x.filter = filter;
    x.drawImage(src, 0, 0);
    return c;
  };
  const pixels = (src, fn) => {
    const c = U.clone(src), x = c.getContext('2d');
    const id = x.getImageData(0, 0, c.width, c.height);
    fn(id.data, c.width, c.height);
    x.putImageData(id, 0, 0);
    return c;
  };
  const blurred = (src, r) => {
    if (r <= 0) return U.clone(src);
    const p = Math.ceil(r * 3);
    const padded = U.padEdges(src, p);
    const b = css(padded, `blur(${r}px)`);
    const c = U.canvas(src.width, src.height), x = c.getContext('2d');
    x.drawImage(b, -p, -p);
    return c;
  };
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  const F = {
    brightnessContrast: (src, p) => css(src, `brightness(${100 + p.brightness}%) contrast(${100 + p.contrast}%)`),
    hueSaturation: (src, p) => css(src, `hue-rotate(${p.hue}deg) saturate(${100 + p.saturation}%) brightness(${100 + p.lightness}%)`),
    temperature: (src, p) => pixels(src, d => {
      const t = p.temperature * 0.6, g = p.tint * 0.6;
      for (let i = 0; i < d.length; i += 4) { d[i] += t; d[i + 1] -= g; d[i + 2] -= t; }
    }),
    vibrance: (src, p) => pixels(src, d => {
      const amt = p.vibrance / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const s = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
        const k = 1 + amt * (1 - s);
        const l = lum(d, i);
        d[i] = l + (r - l) * k; d[i + 1] = l + (g - l) * k; d[i + 2] = l + (b - l) * k;
      }
    }),
    levels: (src, p) => pixels(src, d => {
      const lo = p.black, hi = Math.max(lo + 1, p.white), gm = 1 / (p.gamma / 100);
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(U.clamp((v - lo) / (hi - lo), 0, 1), gm);
      for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    }),
    autoLevels: (src) => pixels(src, d => {
      const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      let n = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; n++; hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; }
      const clip = n * 0.005;
      const luts = hist.map(hh => {
        let lo = 0, hi = 255, acc = 0;
        while (lo < 255 && (acc += hh[lo]) <= clip) lo++;
        acc = 0;
        while (hi > 0 && (acc += hh[hi]) <= clip) hi--;
        const lut = new Uint8ClampedArray(256);
        for (let v = 0; v < 256; v++) lut[v] = hi > lo ? (v - lo) * 255 / (hi - lo) : v;
        return lut;
      });
      for (let i = 0; i < d.length; i += 4) { d[i] = luts[0][d[i]]; d[i + 1] = luts[1][d[i + 1]]; d[i + 2] = luts[2][d[i + 2]]; }
    }),
    desaturate: (src) => pixels(src, d => { for (let i = 0; i < d.length; i += 4) { const l = lum(d, i); d[i] = d[i + 1] = d[i + 2] = l; } }),
    invert: (src) => pixels(src, d => { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } }),
    sepia: (src) => pixels(src, d => {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = r * .393 + g * .769 + b * .189; d[i + 1] = r * .349 + g * .686 + b * .168; d[i + 2] = r * .272 + g * .534 + b * .131;
      }
    }),
    posterize: (src, p) => pixels(src, d => {
      const n = Math.max(2, p.levels) - 1;
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k] / 255 * n) * 255 / n;
    }),
    threshold: (src, p) => pixels(src, d => {
      for (let i = 0; i < d.length; i += 4) { const v = lum(d, i) >= p.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
    }),
    blur: (src, p) => blurred(src, p.radius),
    sharpen: (src, p) => {
      const b = blurred(src, p.radius);
      const bd = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      const amt = p.amount / 100, th = p.threshold;
      return pixels(src, d => {
        for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) {
          const diff = d[i + k] - bd[i + k];
          if (Math.abs(diff) >= th) d[i + k] = d[i + k] + diff * amt;
        }
      });
    },
    noise: (src, p) => pixels(src, d => {
      const a = p.amount * 2.55;
      for (let i = 0; i < d.length; i += 4) {
        if (p.mono) { const n = (Math.random() - 0.5) * a; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
        else { d[i] += (Math.random() - 0.5) * a; d[i + 1] += (Math.random() - 0.5) * a; d[i + 2] += (Math.random() - 0.5) * a; }
      }
    }),
    pixelate: (src, p) => {
      const s = Math.max(1, p.size), w = src.width, h = src.height;
      const sw = Math.ceil(w / s), sh = Math.ceil(h / s);
      const small = U.canvas(sw, sh), sx = small.getContext('2d');
      sx.imageSmoothingQuality = 'high';
      sx.drawImage(src, 0, 0, sw * s, sh * s, 0, 0, sw, sh);
      const c = U.canvas(w, h), x = c.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.drawImage(small, 0, 0, sw, sh, 0, 0, sw * s, sh * s);
      return c;
    },
    vignette: (src, p) => {
      const c = U.clone(src), x = c.getContext('2d'), w = c.width, h = c.height;
      const r = Math.hypot(w, h) / 2;
      const g = x.createRadialGradient(w / 2, h / 2, r * (1 - p.size / 100), w / 2, h / 2, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${p.amount / 100})`);
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      return c;
    },
  };
  App.filterFns = F;

  /** Apply instantly to the active layer. */
  function instant(label, fn) {
    const L = App.activeLayer();
    const before = U.clone(L.canvas);
    App.applyResult(L, before, fn(before, {}));
    App.history.push(label);
  }

  /** Open a dialog with live preview. params: [{key,label,min,max,step,value,unit,type}] */
  function dialog(title, params, fn) {
    const L = App.activeLayer();
    const before = U.clone(L.canvas);
    const values = Object.fromEntries(params.map(p => [p.key, p.value]));
    let pending = false, done = false;
    const preview = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        if (done) return;
        App.applyResult(L, before, fn(before, values));
      }, 16);
    };
    const body = document.createElement('div');
    body.className = 'form';
    for (const p of params) {
      if (p.type === 'check') {
        body.appendChild(App.ui.checkRow(p.label, values[p.key], v => { values[p.key] = v; preview(); }));
      } else {
        body.appendChild(App.ui.sliderRow(p.label, p.min, p.max, p.step || 1, values[p.key], p.unit || '', v => { values[p.key] = v; preview(); }));
      }
    }
    if (App.selection.mask) {
      const n = document.createElement('div'); n.className = 'hint'; n.textContent = 'Applied within the current selection.';
      body.appendChild(n);
    }
    App.ui.dialog({
      title, content: body, okLabel: 'Apply',
      onOk: () => { done = true; App.applyResult(L, before, fn(before, values)); App.history.push(title); },
      onCancel: () => {
        done = true;
        L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
        L.ctx.drawImage(before, 0, 0);
        App.layerChanged(L);
      },
    });
    preview();
  }

  App.filters = {
    brightnessContrast: () => dialog('Brightness/Contrast', [
      { key: 'brightness', label: 'Brightness', min: -100, max: 150, value: 0 },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100, value: 0 }], F.brightnessContrast),
    hueSaturation: () => dialog('Hue/Saturation', [
      { key: 'hue', label: 'Hue', min: -180, max: 180, value: 0, unit: '°' },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100, value: 0 },
      { key: 'lightness', label: 'Lightness', min: -100, max: 100, value: 0 }], F.hueSaturation),
    temperature: () => dialog('Color Temperature', [
      { key: 'temperature', label: 'Temperature', min: -100, max: 100, value: 0 },
      { key: 'tint', label: 'Tint', min: -100, max: 100, value: 0 }], F.temperature),
    vibrance: () => dialog('Vibrance', [{ key: 'vibrance', label: 'Vibrance', min: -100, max: 100, value: 30 }], F.vibrance),
    levels: () => dialog('Levels', [
      { key: 'black', label: 'Black point', min: 0, max: 254, value: 0 },
      { key: 'gamma', label: 'Gamma', min: 10, max: 300, value: 100, unit: '%' },
      { key: 'white', label: 'White point', min: 1, max: 255, value: 255 }], F.levels),
    posterize: () => dialog('Posterize', [{ key: 'levels', label: 'Levels', min: 2, max: 32, value: 6 }], F.posterize),
    threshold: () => dialog('Threshold', [{ key: 'level', label: 'Level', min: 0, max: 255, value: 128 }], F.threshold),
    blur: () => dialog('Gaussian Blur', [{ key: 'radius', label: 'Radius', min: 0, max: 100, step: 0.5, value: 4, unit: 'px' }], F.blur),
    sharpen: () => dialog('Unsharp Mask', [
      { key: 'amount', label: 'Amount', min: 0, max: 300, value: 80, unit: '%' },
      { key: 'radius', label: 'Radius', min: 0.5, max: 20, step: 0.5, value: 1.5, unit: 'px' },
      { key: 'threshold', label: 'Threshold', min: 0, max: 50, value: 2 }], F.sharpen),
    noise: () => dialog('Add Noise', [
      { key: 'amount', label: 'Amount', min: 0, max: 100, value: 12, unit: '%' },
      { key: 'mono', label: 'Monochromatic', type: 'check', value: true }], F.noise),
    pixelate: () => dialog('Pixelate', [{ key: 'size', label: 'Cell size', min: 2, max: 128, value: 12, unit: 'px' }], F.pixelate),
    vignette: () => dialog('Vignette', [
      { key: 'amount', label: 'Darkness', min: 0, max: 100, value: 60, unit: '%' },
      { key: 'size', label: 'Size', min: 5, max: 100, value: 55, unit: '%' }], F.vignette),
    autoLevels: () => instant('Auto Levels', F.autoLevels),
    desaturate: () => instant('Desaturate', F.desaturate),
    invert: () => instant('Invert', F.invert),
    sepia: () => instant('Sepia', F.sepia),
  };
})(window.App);
