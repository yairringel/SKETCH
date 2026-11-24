'use strict';
/* Gemini integration: edit the image / selection, or generate new images. */
(function (App) {
  const U = App.util;
  const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const STORE = 'sketch.gemini.settings';

  const MODELS = [
    ['gemini-2.5-flash-image', 'Gemini 2.5 Flash Image (fast)'],
    ['gemini-3-pro-image-preview', 'Gemini 3 Pro Image (best quality)'],
    ['custom', 'Custom model id…'],
  ];
  const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  const ratioVal = (s) => { const [a, b] = s.split(':').map(Number); return a / b; };

  const EDIT_PRESETS = [
    ['Remove object', 'Remove the object in the marked area and fill in the background realistically, so it looks like it was never there.'],
    ['Replace background', 'Replace the background with a clean, softly lit studio backdrop. Keep the subject exactly as it is.'],
    ['Enhance', 'Enhance this image: improve sharpness, fine detail, lighting and color, without changing the content or composition.'],
    ['Golden hour', 'Relight the scene with warm golden-hour sunlight. Keep everything else the same.'],
    ['Watercolor', 'Turn this into a delicate watercolor painting, keeping the composition.'],
    ['Colorize', 'Colorize this photo with natural, realistic colors.'],
    ['Add…', 'Add a ___ in the marked area, matching the lighting, perspective and style of the scene.'],
  ];
  const GEN_PRESETS = [
    ['Photo', 'A photorealistic image of ___, natural light, 50mm lens, high detail.'],
    ['Illustration', 'A clean flat vector illustration of ___, limited color palette.'],
    ['Texture', 'A seamless tileable texture of ___, top-down, even lighting.'],
    ['Product shot', 'A studio product photo of ___ on a white background with soft shadows.'],
  ];

  const settings = Object.assign(
    { apiKey: '', model: MODELS[0][0], customModel: '', imageSize: '', maxUpload: 2048 },
    (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; } })()
  );
  const saveSettings = () => { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* ignore */ } };
  const modelId = () => (settings.model === 'custom' ? settings.customModel.trim() : settings.model) || MODELS[0][0];

  const st = { mode: 'edit', source: 'composite', padding: 25, feather: 4, maskHint: true, variations: 1, aspect: 'match', genOutput: 'layer', refs: [] };

  // --------------------------------------------------------- geometry
  function nearestRatios(r) {
    return RATIOS.slice().sort((a, b) => Math.abs(Math.log(ratioVal(a) / r)) - Math.abs(Math.log(ratioVal(b) / r)));
  }
  /** Expand the selection bounds by padding, then grow to a Gemini-supported aspect ratio (staying inside the doc). */
  function fitRegion(b, dw, dh, padFrac) {
    const pad = Math.round(Math.max(b.w, b.h) * padFrac);
    const x0 = Math.max(0, b.x - pad), y0 = Math.max(0, b.y - pad);
    const x1 = Math.min(dw, b.x + b.w + pad), y1 = Math.min(dh, b.y + b.h + pad);
    const min = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const cx = min.x + min.w / 2, cy = min.y + min.h / 2;
    for (const ratio of nearestRatios(min.w / min.h)) {
      const R = ratioVal(ratio);
      let w = min.w, h = min.h;
      if (w / h < R) w = h * R; else h = w / R;
      w = Math.round(w); h = Math.round(h);
      if (w > dw || h > dh) continue;
      const x = U.clamp(Math.round(cx - w / 2), 0, dw - w), y = U.clamp(Math.round(cy - h / 2), 0, dh - h);
      return { rect: { x, y, w, h }, ratio };
    }
    return { rect: min, ratio: nearestRatios(min.w / min.h)[0] };
  }

  function encode(c, mime, q) {
    const url = c.toDataURL(mime, q);
    return { mime, data: url.slice(url.indexOf(',') + 1) };
  }

  // --------------------------------------------------------------- API
  async function callGemini({ prompt, images, aspectRatio, signal }) {
    if (!settings.apiKey) throw new Error('Add your Gemini API key under Settings (bottom of the AI panel).');
    const model = modelId();
    const parts = [{ text: prompt }, ...images.map(i => ({ inlineData: { mimeType: i.mime, data: i.data } }))];
    const imageConfig = {};
    if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
    if (settings.imageSize) imageConfig.imageSize = settings.imageSize;
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig },
    };
    const res = await fetch(API + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
      body: JSON.stringify(body),
      signal,
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error((json && json.error && json.error.message) || `HTTP ${res.status}`);
    if (json.promptFeedback && json.promptFeedback.blockReason) throw new Error('Prompt blocked: ' + json.promptFeedback.blockReason);
    const cand = json.candidates && json.candidates[0];
    const out = (cand && cand.content && cand.content.parts) || [];
    const imgs = []; let text = '';
    for (const p of out) {
      if (p.thought) continue;
      const d = p.inlineData || p.inline_data;
      if (d && d.data) imgs.push({ mime: d.mimeType || d.mime_type || 'image/png', data: d.data });
      else if (p.text) text += p.text;
    }
    if (!imgs.length) throw new Error(text.trim() || `No image returned (finish reason: ${(cand && cand.finishReason) || 'unknown'})`);
    const im = imgs[imgs.length - 1];
    const img = await U.loadImage(`data:${im.mime};base64,${im.data}`);
    return { img, text: text.trim() };
  }

  // ---------------------------------------------------------- actions
  const G = App.gemini = { busy: false, busyRect: null, controller: null, settings, callGemini };

  async function runMany(n, args) {
    const results = await Promise.allSettled(Array.from({ length: n }, () => callGemini(args)));
    const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const errs = results.filter(r => r.status === 'rejected').map(r => r.reason);
    if (!ok.length) throw errs[0];
    return { ok, errs };
  }

  async function runEdit(prompt, signal) {
    const d = App.doc, mask = App.selection.mask, b = App.selection.bounds;
    let rect, ratio;
    if (mask && b) ({ rect, ratio } = fitRegion(b, d.width, d.height, st.padding / 100));
    else { rect = { x: 0, y: 0, w: d.width, h: d.height }; ratio = nearestRatios(d.width / d.height)[0]; }
    G.busyRect = rect;

    const src = st.source === 'layer' ? App.activeLayer().canvas : App.getComposite();
    const s = Math.min(1, settings.maxUpload / Math.max(rect.w, rect.h));
    const cw = Math.max(1, Math.round(rect.w * s)), ch = Math.max(1, Math.round(rect.h * s));
    const crop = U.canvas(cw, ch), cx = crop.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch);

    const images = [encode(crop, 'image/jpeg', 0.92)];
    let text = prompt.trim();
    if (mask) {
      if (st.maskHint) {
        const mc = U.canvas(cw, ch), mx = mc.getContext('2d');
        mx.fillStyle = '#000'; mx.fillRect(0, 0, cw, ch);
        mx.drawImage(mask, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch);
        images.push(encode(mc, 'image/png'));
        text += '\n\nThe first image is the picture to edit. The second image is a black-and-white mask with the same framing: ' +
          'apply the requested change ONLY inside the white area, and keep everything in the black area unchanged. ' +
          'Return the complete edited picture with exactly the same framing as the first image (do not return the mask).';
      } else {
        text += '\n\nReturn the complete edited picture with exactly the same framing as the input image.';
      }
    } else {
      text += '\n\nReturn the complete edited picture with the same framing and composition.';
    }
    if (st.refs.length) {
      images.push(...st.refs.map(r => r.enc));
      text += `\n\nThe last ${st.refs.length} image(s) are reference images to use for the requested change.`;
    }

    const { ok, errs } = await runMany(st.variations, { prompt: text, images, aspectRatio: ratio, signal });
    if (signal.aborted) return;
    const edgeMask = mask ? App.selection.feathered(mask, st.feather) : null;
    const name = '✨ ' + prompt.trim().slice(0, 40);
    let firstIdx = -1;
    ok.forEach((r, i) => {
      const L = App.layers.add(ok.length > 1 ? `${name} (v${i + 1})` : name, { history: false });
      if (firstIdx < 0) firstIdx = App.doc.active;
      L.ctx.imageSmoothingQuality = 'high';
      L.ctx.drawImage(r.img, rect.x, rect.y, rect.w, rect.h);
      if (edgeMask) {
        L.ctx.globalCompositeOperation = 'destination-in';
        L.ctx.drawImage(edgeMask, 0, 0);
        L.ctx.globalCompositeOperation = 'source-over';
      }
      L.visible = i === 0;
      L.rev++;
    });
    App.layers.select(firstIdx);
    App.markDirty(); App.emit('pixels');
    App.history.push('Gemini Edit');
    report(ok, errs, ok.length > 1 ? `Added ${ok.length} variation layers — toggle their visibility to compare.` : 'Added result as a new layer.');
  }

  async function runGenerate(prompt, signal) {
    const d = App.doc;
    const ratio = st.aspect === 'match' ? nearestRatios(d.width / d.height)[0] : st.aspect;
    G.busyRect = null;
    let text = prompt.trim();
    if (st.refs.length) text += `\n\nUse the attached ${st.refs.length} image(s) as reference.`;
    const { ok, errs } = await runMany(st.variations, { prompt: text, images: st.refs.map(r => r.enc), aspectRatio: ratio, signal });
    if (signal.aborted) return;
    if (st.genOutput === 'document') {
      if (App.isPristine() || confirm('Replace the current document with the generated image? (Unsaved changes will be lost.)')) {
        App.openImage(ok[0].img, 'Generated');
        for (let i = 1; i < ok.length; i++) {
          const L = App.ops.placeImage(ok[i].img, `Generated (v${i + 1})`);
          L.visible = false; App.markDirty(); App.emit('layers');
        }
        report(ok, errs, 'Opened as a new document.');
        return;
      }
    }
    const name = '✨ ' + prompt.trim().slice(0, 40);
    let firstIdx = -1;
    ok.forEach((r, i) => {
      const L = App.layers.add(ok.length > 1 ? `${name} (v${i + 1})` : name, { history: false });
      if (firstIdx < 0) firstIdx = App.doc.active;
      const iw = r.img.naturalWidth, ih = r.img.naturalHeight;
      const sc = (st.aspect === 'match' ? Math.max : Math.min)(d.width / iw, d.height / ih);
      L.ctx.imageSmoothingQuality = 'high';
      L.ctx.drawImage(r.img, (d.width - iw * sc) / 2, (d.height - ih * sc) / 2, iw * sc, ih * sc);
      L.visible = i === 0;
      L.rev++;
    });
    App.layers.select(firstIdx);
    App.markDirty(); App.emit('pixels');
    App.history.push('Gemini Generate');
    report(ok, errs, ok.length > 1 ? `Added ${ok.length} variation layers.` : 'Added as a new layer.');
  }

  function report(ok, errs, msg) {
    const texts = ok.map(r => r.text).filter(Boolean);
    let s = msg;
    if (errs.length) s += `\n${errs.length} variation(s) failed: ${errs[0].message}`;
    if (texts.length) s += '\n\nGemini: ' + texts[0];
    setStatus(s, errs.length ? 'warn' : 'ok');
    App.toast('✨ ' + msg);
  }

  // --------------------------------------------------------------- UI
  let els = {};
  let timer = 0;

  function setStatus(msg, kind) {
    els.status.textContent = msg || '';
    els.status.className = 'ai-status' + (kind ? ' ' + kind : '');
  }

  function setBusy(b) {
    G.busy = b;
    els.run.disabled = b;
    els.cancel.hidden = !b;
    els.panel.classList.toggle('busy', b);
    clearInterval(timer);
    if (b) {
      const t0 = Date.now();
      const tick = () => setStatus(`Working with ${modelId()}… ${Math.round((Date.now() - t0) / 1000)}s`, 'busy');
      tick(); timer = setInterval(tick, 1000);
    } else { G.busyRect = null; }
    App.requestRender();
  }

  async function run() {
    if (G.busy || !App.doc) return;
    const prompt = els.prompt.value;
    if (!prompt.trim()) { els.prompt.focus(); App.toast('Write a prompt first'); return; }
    if (!settings.apiKey) { els.settings.open = true; els.key.focus(); App.toast('Add your Gemini API key first', 'error'); return; }
    if (prompt.includes('___')) { App.toast('Fill in the ___ placeholder in the prompt'); els.prompt.focus(); return; }
    const controller = new AbortController();
    G.controller = controller;
    setBusy(true);
    try {
      if (st.mode === 'edit') await runEdit(prompt, controller.signal);
      else await runGenerate(prompt, controller.signal);
      clearInterval(timer);
    } catch (e) {
      clearInterval(timer);
      if (e.name === 'AbortError') setStatus('Cancelled.');
      else { console.error(e); setStatus('Error: ' + e.message, 'error'); App.toast('Gemini: ' + e.message, 'error'); }
    } finally {
      G.controller = null;
      G.busy = false;
      els.run.disabled = false; els.cancel.hidden = true; els.panel.classList.remove('busy');
      G.busyRect = null; App.requestRender();
    }
  }

  function updateTarget() {
    if (!els.target || !App.doc) return;
    const b = App.selection.bounds;
    if (st.mode === 'edit') {
      els.target.innerHTML = b
        ? `<b>Target:</b> selection (${b.w}×${b.h}px) — result is blended back as a masked layer`
        : `<b>Target:</b> whole image (${App.doc.width}×${App.doc.height}px). Select an area to edit just that part.`;
    }
    els.selOnly.hidden = !b;
  }

  function renderChips() {
    els.chips.innerHTML = '';
    for (const [label, text] of (st.mode === 'edit' ? EDIT_PRESETS : GEN_PRESETS)) {
      const c = document.createElement('button');
      c.className = 'chip'; c.textContent = label; c.title = text;
      c.onclick = () => {
        els.prompt.value = text;
        els.prompt.focus();
        const i = text.indexOf('___');
        if (i >= 0) els.prompt.setSelectionRange(i, i + 3);
      };
      els.chips.appendChild(c);
    }
  }

  function renderRefs() {
    els.refList.innerHTML = '';
    st.refs.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'ref';
      d.title = r.name;
      d.style.backgroundImage = `url(${r.thumb})`;
      const x = document.createElement('button');
      x.textContent = '×'; x.title = 'Remove';
      x.onclick = () => { st.refs.splice(i, 1); renderRefs(); };
      d.appendChild(x);
      els.refList.appendChild(d);
    });
    els.refList.hidden = !st.refs.length;
  }

  async function addRefFromCanvas(c, name) {
    const s = Math.min(1, settings.maxUpload / Math.max(c.width, c.height));
    const r = U.canvas(c.width * s, c.height * s), x = r.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, r.width, r.height);
    const t = U.canvas(64 * Math.min(1, r.width / r.height) || 64, 64 * Math.min(1, r.height / r.width) || 64);
    t.getContext('2d').drawImage(r, 0, 0, t.width, t.height);
    st.refs.push({ name, enc: encode(r, 'image/png'), thumb: t.toDataURL() });
    renderRefs();
  }

  async function addRefFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const img = await U.fileToImage(f);
        const c = U.canvas(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, 0, 0);
        await addRefFromCanvas(c, f.name);
      } catch (e) { App.toast('Could not load ' + f.name, 'error'); }
    }
  }

  G.addSelectionAsRef = () => {
    const sel = App.selection.mask, b = App.selection.bounds;
    const src = App.getComposite();
    let c;
    if (sel && b) {
      c = U.canvas(b.w, b.h);
      const x = c.getContext('2d');
      x.drawImage(src, -b.x, -b.y);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(sel, -b.x, -b.y);
    } else c = U.clone(src);
    addRefFromCanvas(c, sel ? 'Selection' : 'Canvas');
    App.toast('Added as reference image');
  };

  G.init = (root) => {
    const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    root.innerHTML = `
      <div class="seg full" id="ai-mode">
        <button data-mode="edit" class="on">Edit image</button>
        <button data-mode="generate">Generate new</button>
      </div>
      <textarea id="ai-prompt" rows="4" spellcheck="true"></textarea>
      <div class="chips" id="ai-chips"></div>
      <div id="ai-edit-opts">
        <div class="ai-target" id="ai-target"></div>
        <label class="row"><span>Source</span>
          <select id="ai-source">${opt('composite', 'Visible image (all layers)', st.source)}${opt('layer', 'Active layer only', st.source)}</select></label>
        <div id="ai-sel-only"></div>
      </div>
      <div id="ai-gen-opts" hidden>
        <label class="row"><span>Aspect</span>
          <select id="ai-aspect">${opt('match', 'Match canvas', st.aspect)}${RATIOS.map(r => opt(r, r, st.aspect)).join('')}</select></label>
        <label class="row"><span>Output</span>
          <select id="ai-out">${opt('layer', 'New layer (fit to canvas)', st.genOutput)}${opt('document', 'Replace document', st.genOutput)}</select></label>
      </div>
      <div class="row"><span>Variations</span><div class="seg" id="ai-var">${[1, 2, 3, 4].map(n => `<button data-n="${n}"${n === st.variations ? ' class="on"' : ''}>${n}</button>`).join('')}</div></div>
      <div class="refs">
        <div class="refs-head"><span>Reference images</span>
          <span><button class="link" id="ai-ref-sel" title="Use the current selection (or the whole canvas) as a reference image">+ from canvas</button>
          <button class="link" id="ai-ref-add">+ file</button></span></div>
        <div id="ai-ref-list" class="ref-list" hidden></div>
      </div>
      <div class="ai-actions">
        <button class="btn ai" id="ai-run"><svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg><span>Apply with Gemini</span></button>
        <button class="btn" id="ai-cancel" hidden>Cancel</button>
      </div>
      <div class="ai-status" id="ai-status"></div>
      <details id="ai-settings">
        <summary>Settings</summary>
        <label class="col"><span>Gemini API key <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">get one ↗</a></span>
          <span class="keyrow"><input type="password" id="ai-key" placeholder="AIza…" autocomplete="off"><button class="btn sm" id="ai-key-show">Show</button></span></label>
        <label class="col"><span>Model</span><select id="ai-model">${MODELS.map(([v, l]) => opt(v, l, settings.model)).join('')}</select></label>
        <label class="col" id="ai-custom-wrap"><span>Custom model id</span><input id="ai-custom" placeholder="e.g. gemini-2.5-flash-image"></label>
        <label class="row"><span>Output size</span><select id="ai-size">${opt('', 'Model default', settings.imageSize)}${opt('1K', '1K', settings.imageSize)}${opt('2K', '2K (Pro only)', settings.imageSize)}${opt('4K', '4K (Pro only)', settings.imageSize)}</select></label>
        <label class="row"><span>Max upload</span><select id="ai-up">${[1024, 1536, 2048, 3072].map(n => opt(String(n), n + ' px', String(settings.maxUpload))).join('')}</select></label>
        <p class="hint">Your key is stored only in this browser (localStorage) and sent only to Google's Gemini API.</p>
      </details>
      <input type="file" id="ai-ref-file" accept="image/*" multiple hidden>`;

    const $ = (id) => root.querySelector('#' + id);
    els = {
      panel: root.closest('.panel') || root, prompt: $('ai-prompt'), chips: $('ai-chips'), target: $('ai-target'),
      selOnly: $('ai-sel-only'), run: $('ai-run'), cancel: $('ai-cancel'), status: $('ai-status'), settings: $('ai-settings'),
      key: $('ai-key'), refList: $('ai-ref-list'),
    };

    els.selOnly.appendChild(App.ui.sliderRow('Context', 0, 150, 5, st.padding, '%', v => { st.padding = v; }, 'Extra surrounding area sent to Gemini so the edit blends with its context'));
    els.selOnly.appendChild(App.ui.sliderRow('Edge blend', 0, 60, 1, st.feather, 'px', v => { st.feather = v; }, 'Feathering of the result layer\'s mask edges'));
    els.selOnly.appendChild(App.ui.checkRow('Send selection mask to Gemini', st.maskHint, v => { st.maskHint = v; }));

    const setMode = (m) => {
      st.mode = m;
      root.querySelectorAll('#ai-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
      $('ai-edit-opts').hidden = m !== 'edit';
      $('ai-gen-opts').hidden = m !== 'generate';
      els.prompt.placeholder = m === 'edit'
        ? 'Describe the change… e.g. "replace the sky with a dramatic sunset" (Ctrl+Enter to run)'
        : 'Describe the image to create… (Ctrl+Enter to run)';
      els.run.querySelector('span').textContent = m === 'edit' ? 'Apply with Gemini' : 'Generate with Gemini';
      renderChips(); updateTarget();
    };
    root.querySelectorAll('#ai-mode button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    root.querySelectorAll('#ai-var button').forEach(b => b.onclick = () => {
      st.variations = +b.dataset.n;
      root.querySelectorAll('#ai-var button').forEach(x => x.classList.toggle('on', x === b));
    });
    $('ai-source').onchange = e => { st.source = e.target.value; };
    $('ai-aspect').onchange = e => { st.aspect = e.target.value; };
    $('ai-out').onchange = e => { st.genOutput = e.target.value; };
    els.prompt.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
    els.run.onclick = run;
    els.cancel.onclick = () => { if (G.controller) G.controller.abort(); };

    $('ai-ref-add').onclick = () => $('ai-ref-file').click();
    $('ai-ref-file').onchange = e => { addRefFiles([...e.target.files]); e.target.value = ''; };
    $('ai-ref-sel').onclick = () => G.addSelectionAsRef();

    els.key.value = settings.apiKey;
    els.key.oninput = () => { settings.apiKey = els.key.value.trim(); saveSettings(); };
    $('ai-key-show').onclick = (e) => { const p = els.key.type === 'password'; els.key.type = p ? 'text' : 'password'; e.target.textContent = p ? 'Hide' : 'Show'; };
    const custom = $('ai-custom');
    custom.value = settings.customModel;
    const syncCustom = () => { $('ai-custom-wrap').hidden = settings.model !== 'custom'; };
    $('ai-model').onchange = e => { settings.model = e.target.value; saveSettings(); syncCustom(); };
    custom.oninput = () => { settings.customModel = custom.value; saveSettings(); };
    $('ai-size').onchange = e => { settings.imageSize = e.target.value; saveSettings(); };
    $('ai-up').onchange = e => { settings.maxUpload = +e.target.value; saveSettings(); };
    syncCustom();
    if (!settings.apiKey) els.settings.open = true;

    App.on('selection', updateTarget);
    App.on('doc', updateTarget);
    setMode('edit');
    renderRefs();
    setStatus('');
  };

  G.focusPrompt = () => { if (els.prompt) els.prompt.focus(); };

  G.drawOverlay = (ctx) => {
    if (!G.busy || !G.busyRect) return;
    const v = App.view, r = G.busyRect;
    const x = r.x * v.zoom + v.panX, y = r.y * v.zoom + v.panY, w = r.w * v.zoom, h = r.h * v.zoom;
    ctx.save();
    const a = 0.12 + 0.08 * Math.sin(App.antPhase / 4);
    ctx.fillStyle = `rgba(140,110,255,${a})`;
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#a58bff';
    ctx.setLineDash([8, 6]); ctx.lineDashOffset = -App.antPhase * 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  };
})(window.App);
