// Lick detail "material board": the lick's materials (notes text, PDFs, score
// images, videos, audio players, links) as free-form blocks on a canvas.
//
// - Sources are derived from the lick (score_images / demo_url / pdf_url /
//   source_url) and from the rendered notes (embeds are lifted out of the
//   text). The notes Markdown stays the single source of truth for WHICH
//   materials exist; `lick.layout` only stores WHERE they sit.
// - Layout (saved to the backend as lick.layout, only after the user changes
//   something): { v:1, hidden:[sourceId], blocks:[{id, of, x, y, w, h, page}] }
//   x/w are in 1/LKB_COLS of the canvas width, y/h in px (multiples of LKB_SNAP).
// - A block is dragged by its header, resized by its right / bottom / corner
//   edges. A block that gets overlapped moves aside (right if cheaper, else down).
// Below LKB_MIN_WIDTH px the page falls back to the old single-column layout.

const LKB_COLS = 120, LKB_MINW = 20, LKB_GAP = 10, LKB_SNAP = 10, LKB_MIN_WIDTH = 900;
const LKB_MIN_H = 80;
const LKB_ICON = { pdf: '📄', img: '🖼', video: '🎬', audio: '🎧', text: '📝', link: '🔗' };

const lkb = { lick: null, sources: new Map(), layout: null, canvas: null, saveTimer: null };

function lkbEnabled() {
  return window.innerWidth >= LKB_MIN_WIDTH;
}

// ── Sources ──

function lkbSafeUrl(u) { return /^(\/api\/|https?:\/\/)/.test(u || ''); }

function lkbFileName(href) {
  try {
    const n = decodeURIComponent(String(href).split('?')[0].split('/').pop() || href);
    return n.replace(/^\d{14,}_/, '');
  } catch (_) { return String(href); }
}

// The link that introduced an embed. marked emits `<p><a/><div embed/></p>`
// and the HTML parser closes the <p> at the <div>, so the label link ends up
// as the last child of the previous <p> (or a direct sibling).
function lkbTakeLabel(w) {
  let prev = w.previousElementSibling;
  if (prev && prev.tagName === 'P' && prev.lastElementChild && prev.lastElementChild.tagName === 'A'
      && prev.lastElementChild.nextSibling === null) {
    const a = prev.lastElementChild;
    const text = a.textContent.trim();
    a.remove();
    if (!prev.textContent.trim() && !prev.querySelector('img,iframe,video,audio')) prev.remove();
    return text;
  }
  if (prev && prev.tagName === 'A') { const text = prev.textContent.trim(); prev.remove(); return text; }
  return '';
}

// Walks the rendered notes; every media embed becomes a source and is removed
// from the text. Returns { sources: [...], textHtml }.
function lkbCollectSources(lick) {
  const sources = [];
  const seen = new Map();
  const add = (base, src) => {
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    sources.push({ ...src, id: n === 1 ? base : `${base}#${n}` });
  };

  let textHtml = '';
  const tmp = document.createElement('div');
  if (lick.notes) tmp.innerHTML = licksRenderNotes(lick.notes);

  (lick.score_images || []).filter(lkbSafeUrl).forEach((u, i) =>
    add('img:' + u, { kind: 'img', title: `核心谱 ${i + 1}`, href: u }));
  if (lkbSafeUrl(lick.demo_url)) add('video:' + lick.demo_url, { kind: 'video', title: '示范视频', href: lick.demo_url, file: true });
  if (lkbSafeUrl(lick.pdf_url)) add('pdf:' + lick.pdf_url, { kind: 'pdf', title: lkbFileName(lick.pdf_url), href: lick.pdf_url, page: 1 });

  {
    const dropEmpty = el => {
      const p = el && el.parentElement;
      el.remove();
      if (p && p.tagName === 'P' && !p.textContent.trim() && !p.querySelector('img,iframe,video,audio')) p.remove();
    };
    tmp.querySelectorAll('.lick-pdf-embed').forEach(w => {
      const label = lkbTakeLabel(w);
      const href = w.dataset.href;
      if (!lkbSafeUrl(href)) return;
      add('pdf:' + href, { kind: 'pdf', title: label || lkbFileName(href), href, page: +(w.dataset.page || 1) });
      dropEmpty(w);
    });
    tmp.querySelectorAll('.lick-video-embed').forEach(w => {
      const label = lkbTakeLabel(w) || '视频';
      const v = w.querySelector('video');
      const th = w.querySelector('.lick-video-thumb');
      const key = v ? v.getAttribute('src') : th ? th.dataset.src : '';
      add('video:' + key, { kind: 'video', title: label, html: w.outerHTML.replace(/ data-ml-idx="\d+"/, '') });
      dropEmpty(w);
    });
    // All audio of the lick goes into ONE "音轨" block (a list of players).
    const tracks = [];
    tmp.querySelectorAll('.lick-audio-embed').forEach(w => {
      const player = w.querySelector('.lick-audio-player');
      const url = player ? player.dataset.url : '';
      const btn = w.querySelector('[data-label]');
      const label = lkbTakeLabel(w) || (btn && btn.dataset.label) || lkbFileName(url);
      tracks.push(`<div class="lkb-trk"><div class="lkb-trk-nm" title="${htmlEsc(label)}">${htmlEsc(label)}</div>${w.outerHTML}</div>`);
      dropEmpty(w);
    });
    if (tracks.length) add('tracks', { kind: 'audio', title: `音轨（${tracks.length}）`, html: tracks.join(''), n: tracks.length });
    tmp.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src');
      if (!lkbSafeUrl(src)) return;
      add('img:' + src, { kind: 'img', title: img.alt || lkbFileName(src), href: src });
      dropEmpty(img);
    });
  }
  if (lkbSafeUrl(lick.source_url)) add('link:' + lick.source_url, { kind: 'link', title: '原视频', href: lick.source_url });

  textHtml = tmp.innerHTML.trim();
  if (textHtml) sources.unshift({ id: 'text', kind: 'text', title: '笔记', html: textHtml });
  return { sources, textHtml };
}

// ── Layout model ──

function lkbDefaultSize(kind, src) {
  if (kind === 'audio' && src && src.n) return { w: 60, h: Math.min(420, 50 + src.n * 70) };
  return {
    pdf: { w: 60, h: 640 }, img: { w: 120, h: 340 }, video: { w: 60, h: 340 },
    audio: { w: 60, h: 90 }, text: { w: 60, h: 220 }, link: { w: 40, h: 80 },
  }[kind] || { w: 60, h: 200 };
}

function lkbBottom(blocks) { return blocks.reduce((m, b) => Math.max(m, b.y + b.h), 0); }

// Appends `entry` after the existing blocks: next to the previous block if it
// fits in the row, otherwise on a new row below everything.
function lkbPlaceNew(blocks, entry) {
  const last = blocks[blocks.length - 1];
  if (!last) { entry.x = 0; entry.y = 0; return; }
  if (last.x + last.w + entry.w <= LKB_COLS) { entry.x = last.x + last.w; entry.y = last.y; }
  else { entry.x = 0; entry.y = Math.ceil((lkbBottom(blocks) + LKB_GAP) / LKB_SNAP) * LKB_SNAP; }
}

function lkbNormalizeLayout(raw) {
  const L = { v: 1, hidden: [], blocks: [] };
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.hidden)) L.hidden = raw.hidden.filter(s => typeof s === 'string');
    if (Array.isArray(raw.blocks)) {
      for (const b of raw.blocks) {
        if (!b || typeof b.id !== 'string' || ![b.x, b.y, b.w, b.h].every(Number.isFinite)) continue;
        L.blocks.push({
          id: b.id, of: typeof b.of === 'string' ? b.of : b.id,
          x: b.x, y: b.y, w: b.w, h: b.h, page: Number.isFinite(b.page) ? b.page : 1,
          ...(b.fit === true ? { fit: true } : {}),
        });
      }
    }
  }
  return L;
}

// Drops entries whose source vanished, gives new sources a default spot.
function lkbReconcile() {
  const L = lkb.layout;
  L.blocks = L.blocks.filter(b => lkb.sources.has(b.of));
  const used = new Set(L.blocks.map(b => b.of));
  for (const s of lkb.sources.values()) {
    if (used.has(s.id) || L.hidden.includes(s.id)) continue;
    const sz = lkbDefaultSize(s.kind, s);
    const e = { id: s.id, of: s.id, x: 0, y: 0, w: sz.w, h: sz.h, page: s.page || 1 };
    lkbPlaceNew(L.blocks, e);
    L.blocks.push(e);
  }
  L.hidden = L.hidden.filter(id => lkb.sources.has(id));
}

function lkbUnit() { return lkb.canvas.clientWidth / LKB_COLS; }
function lkbOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h + LKB_GAP && b.y < a.y + a.h + LKB_GAP;
}

// The block `fixed` stays put; anything it overlaps moves aside — right (and
// narrower if needed) when that is the smaller shift, else down. Chained.
function lkbResolve(fixed, blocks) {
  const u = lkbUnit();
  const q = [fixed];
  let guard = 0;
  while (q.length && guard++ < 500) {
    const a = q.shift();
    for (const o of blocks) {
      if (o === a || o === fixed || !lkbOverlap(a, o)) continue;
      const rightPx = (a.x + a.w - o.x) * u, downPx = a.y + a.h + LKB_GAP - o.y;
      let goRight = rightPx <= downPx;
      if (goRight) {
        const nx = a.x + a.w;
        if (nx + LKB_MINW > LKB_COLS) goRight = false;
        else { o.x = nx; if (o.x + o.w > LKB_COLS) o.w = LKB_COLS - o.x; }
      }
      if (!goRight) o.y = Math.ceil((a.y + a.h + LKB_GAP) / LKB_SNAP) * LKB_SNAP;
      q.push(o);
    }
  }
}

// ── Persistence ──

function lkbSave() {
  clearTimeout(lkb.saveTimer);
  lkb.saveTimer = setTimeout(async () => {
    const lick = lkb.lick;
    if (!lick) return;
    const layout = JSON.parse(JSON.stringify(lkb.layout));
    try {
      await api(`/api/licks/${lick.id}`, 'PUT', { layout });
      lick.layout = layout;
      const cached = licksState.licksById[lick.id];
      if (cached) cached.layout = layout;
    } catch (e) { console.warn('failed to save lick layout:', e); }
  }, 400);
}

// ── Rendering ──

function lkbPdfSrc(src, page) {
  return licksPdfViewerSrc(src.href, licksPdfFrag(Math.max(1, page || 1)));
}

function lkbBodyHtml(entry, src) {
  switch (src.kind) {
    case 'pdf':
      return `<div class="lick-pdf-embed lkb-pdf" data-href="${htmlEsc(src.href)}"><iframe loading="lazy" src="${htmlEsc(lkbPdfSrc(src, entry.page))}" title="PDF"></iframe></div>`;
    case 'img': return `<img src="${htmlEsc(src.href)}" alt="${htmlEsc(src.title)}" draggable="false">`;
    case 'video':
      return src.file
        ? `<video controls preload="metadata" src="${htmlEsc(src.href)}"></video>`
        : src.html;
    case 'audio': return `<div class="lkb-pad">${src.html}</div>`;
    case 'link': return `<div class="lkb-pad"><a class="text-primary" href="${htmlEsc(src.href)}" target="_blank" rel="noopener">在 YouTube 打开原视频 ↗</a></div>`;
    case 'text': return `<div class="lkb-pad lick-notes-md lkb-text">${src.html}</div>`;
  }
  return '';
}

function lkbHeaderHtml(entry, src) {
  const same = [...lkb.sources.values()].filter(s => s.kind === src.kind && s.kind !== 'text');
  const title = same.length > 1
    ? `<select data-act="src" title="换一份素材">${same.map(s => `<option value="${htmlEsc(s.id)}"${s.id === entry.of ? ' selected' : ''}>${htmlEsc(s.title)}</option>`).join('')}</select>`
    : `<b title="${htmlEsc(src.title)}">${LKB_ICON[src.kind] || ''} ${htmlEsc(src.title)}</b>`;
  const pager = src.kind === 'pdf'
    ? `<span class="lkb-pp"><button data-act="prev" title="上一页">◀</button><input data-act="page" value="${entry.page || 1}"><button data-act="next" title="下一页">▶</button></span>`
    : '';
  // The notes block can be hidden too (restorable from "添加素材"), but not duplicated.
  const tools = (src.kind === 'text' ? '' : `<button data-act="dup" title="复制一份放在旁边（例如同一个 PDF 的另一页）">＋并排</button>`) +
    `<button data-act="del" title="从面板移除（不会删除${src.kind === 'text' ? '笔记' : '素材'}本身，可从“添加素材”里找回）">×</button>`;
  return `<div class="lkb-h">${title}${pager}<span class="lkb-sp">${tools}</span></div>`;
}

function lkbPlace(el, b) {
  const u = lkbUnit();
  Object.assign(el.style, { left: b.x * u + 'px', top: b.y + 'px', width: b.w * u - LKB_GAP + 'px', height: b.h + 'px' });
}

function lkbFit() {
  const cv = lkb.canvas;
  if (!cv) return;
  cv.querySelectorAll('.lkb-ph').forEach(x => x.remove());
  cv.querySelectorAll('.lkb-blk').forEach(el => {
    const b = lkb.layout.blocks.find(x => x.id === el.dataset.bid);
    if (b) lkbPlace(el, b);
  });
  cv.style.height = Math.max(240, lkbBottom(lkb.layout.blocks)) + 60 + 'px';
}

// The "add material" menu lives in the lick header row (see renderLickDetail).
function lkbMenuHtml() {
  return `<div class="lkb-menu" id="lkb-menu"><button class="btn btn-sm" onclick="lkbToggleMenu()" title="拖标题栏移动 · 拖右边 / 下边 / 右下角改大小">＋ 添加素材 ▾</button><div class="lkb-pop" id="lkb-pop"></div></div>`;
}

function lkbHostHtml() {
  return `<section class="lkb" id="lkb-root" aria-label="素材面板">
    <div class="lkb-canvas" id="lkb-canvas"></div>
  </section>`;
}

function lkbMount(lick) {
  const root = document.getElementById('lkb-canvas');
  if (!root) return;
  lkb.lick = lick;
  lkb.canvas = root;
  // Page-width preference / sidebar changes resize the canvas without a window resize.
  if (lkb.ro) lkb.ro.disconnect();
  lkb.ro = new ResizeObserver(() => { if (lkb.canvas === root && lkb.layout) lkbFit(); });
  lkb.ro.observe(root);
  lkb.layout = lkbNormalizeLayout(lick.layout);
  lkbRebuild();
  lkbApplyFit();
  lkbInitPracticeWindow();
}

// A block flagged `fit` (set by bulk layout scripts) is shrunk/grown once to exactly show its content,
// then the flag is dropped. Blocks stacked below it in the same columns move by the same amount.
function lkbApplyFit() {
  const L = lkb.layout;
  let changed = false;
  for (const b of L.blocks.filter(x => x.fit)) {
    const el = lkb.canvas.querySelector(`[data-bid="${CSS.escape(b.id)}"]`);
    const body = el?.querySelector('.lkb-body');
    if (!body) continue;
    const head = el.querySelector('.lkb-h')?.offsetHeight || 0;
    const h = Math.max(LKB_MIN_H, Math.ceil((head + body.scrollHeight + 2) / LKB_SNAP) * LKB_SNAP);
    const delta = h - b.h, oldBottom = b.y + b.h;
    for (const o of L.blocks) {
      if (o !== b && o.y >= oldBottom && o.x < b.x + b.w && b.x < o.x + o.w) o.y += delta;
    }
    b.h = h;
    delete b.fit;
    changed = true;
  }
  if (!changed) return;
  lkbFit();
  lkbSave();
}

// Re-collects sources (the notes may have changed) and redraws every block.
function lkbRebuild() {
  const { sources } = lkbCollectSources(lkb.lick);
  lkb.sources = new Map(sources.map(s => [s.id, s]));
  lkbReconcile();
  lkbRender();
}

function lkbRender() {
  const cv = lkb.canvas;
  licksAudioStopAll();
  cv.innerHTML = lkb.layout.blocks.map(b => {
    const src = lkb.sources.get(b.of);
    if (!src) return '';
    return `<div class="lkb-blk lkb-${src.kind}" data-bid="${htmlEsc(b.id)}">${lkbHeaderHtml(b, src)}<div class="lkb-body">${lkbBodyHtml(b, src)}</div><div class="lkb-rl"></div><div class="lkb-rr"></div><div class="lkb-rb"></div><div class="lkb-rc"></div></div>`;
  }).join('');
  lkbFit();
  lkbBindBlocks();
  lkbWatchTracks();
  lkbRenderMenu();
  if (!cv.children.length) {
    cv.innerHTML = `<div class="lkb-empty"><p class="empty-state">还没有素材 — 点右上角的“＋ 添加素材”（添加后拖标题栏移动，拖右边 / 下边 / 右下角改大小）</p>
      <div><button class="btn" onclick="lkbPickMaterial()">📎 上传 / 从素材库选择</button>
      <button class="btn btn-ghost" onclick="navOpenLickEdit('${htmlEsc(lkb.lick.id)}')">📝 写笔记</button></div></div>`;
    cv.style.height = '';
  }
}

// A track row counts as "on" while its toggle shows ⏸ (the audio code flips
// the button text on play/pause/end), so watch the text rather than hook events.
function lkbSyncTracks() {
  lkb.canvas?.querySelectorAll('.lkb-trk').forEach(r =>
    r.classList.toggle('on', r.querySelector('.lick-audio-toggle')?.textContent.trim() === '⏸'));
}
function lkbWatchTracks() {
  if (lkb.mo) lkb.mo.disconnect();
  // Observe only each track's play button (not the whole canvas): the time
  // readouts rewrite their text several times a second while playing.
  lkb.mo = new MutationObserver(lkbSyncTracks);
  lkb.canvas.querySelectorAll('.lkb-trk .lick-audio-toggle').forEach(b =>
    lkb.mo.observe(b, { childList: true, characterData: true, subtree: true }));
  lkbSyncTracks();
}

function lkbEntry(bid) { return lkb.layout.blocks.find(b => b.id === bid); }

// ── Actions ──

function lkbDup(bid) {
  const b = lkbEntry(bid);
  if (!b) return;
  const src = lkb.sources.get(b.of);
  let n = 2;
  while (lkbEntry(`${b.of}~${n}`)) n++;
  const e = { ...b, id: `${b.of}~${n}`, page: (b.page || 1) + (src.kind === 'pdf' ? 1 : 0) };
  if (b.x + b.w * 2 <= LKB_COLS) e.x = b.x + b.w;
  else { e.x = b.x; e.y = b.y + b.h + LKB_GAP; }
  lkb.layout.blocks.push(e);
  lkbResolve(e, lkb.layout.blocks);
  lkbSave();
  lkbRender();
}

function lkbDel(bid) {
  const L = lkb.layout;
  const b = lkbEntry(bid);
  if (!b) return;
  L.blocks = L.blocks.filter(x => x.id !== bid);
  if (!L.blocks.some(x => x.of === b.of) && !L.hidden.includes(b.of)) L.hidden.push(b.of);
  lkbSave();
  lkbRender();
}

function lkbSetSrc(bid, srcId) {
  const b = lkbEntry(bid);
  if (!b || !lkb.sources.has(srcId)) return;
  b.of = srcId;
  b.page = lkb.sources.get(srcId).page || 1;
  const L = lkb.layout;
  L.hidden = L.hidden.filter(id => id !== srcId);
  lkbSave();
  lkbRender();
}

function lkbSetPage(bid, page) {
  const b = lkbEntry(bid);
  const el = lkb.canvas.querySelector(`[data-bid="${CSS.escape(bid)}"]`);
  if (!b || !el) return;
  b.page = Math.max(1, Math.round(+page) || 1);
  const iframe = el.querySelector('iframe');
  const app = iframe && iframe.contentWindow && iframe.contentWindow.PDFViewerApplication;
  if (app && app.pagesCount) app.page = Math.min(b.page, app.pagesCount);
  else if (iframe) iframe.src = lkbPdfSrc(lkb.sources.get(b.of), b.page);
  const inp = el.querySelector('input[data-act="page"]');
  if (inp) inp.value = b.page;
  lkbSave();
}

function lkbToggleMenu() { document.getElementById('lkb-menu')?.classList.toggle('open'); }
document.addEventListener('click', e => {
  const m = document.getElementById('lkb-menu');
  if (m && m.classList.contains('open') && !m.contains(e.target)) m.classList.remove('open');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('lkb-menu')?.classList.remove('open');
});

function lkbRenderMenu() {
  const pop = document.getElementById('lkb-pop');
  if (!pop) return;
  const hidden = lkb.layout.hidden.map(id => lkb.sources.get(id)).filter(Boolean);
  pop.innerHTML =
    hidden.map(s => `<div data-restore="${htmlEsc(s.id)}">${LKB_ICON[s.kind]} ${htmlEsc(s.title)}</div>`).join('') +
    (hidden.length ? '<hr>' : '') +
    `<div data-pick="1">📎 上传 / 从素材库选择…</div><div data-edit="1">📝 编辑笔记 / 目标 BPM…</div>`;
  pop.onclick = e => {
    const t = e.target.closest('div');
    if (!t) return;
    document.getElementById('lkb-menu').classList.remove('open');
    if (t.dataset.restore) lkbRestore(t.dataset.restore);
    else if (t.dataset.pick) lkbPickMaterial();
    else if (t.dataset.edit) navOpenLickEdit(lkb.lick.id);
  };
}

function lkbRestore(srcId) {
  const L = lkb.layout;
  const src = lkb.sources.get(srcId);
  if (!src) return;
  L.hidden = L.hidden.filter(id => id !== srcId);
  const sz = lkbDefaultSize(src.kind, src);
  const e = { id: srcId, of: srcId, x: 0, y: 0, w: sz.w, h: sz.h, page: src.page || 1 };
  lkbPlaceNew(L.blocks, e);
  L.blocks.push(e);
  lkbSave();
  lkbRender();
}

// Reuses the editor's material picker: uploads / library picks arrive through
// licksInsertAtNotesCursor, which hands the Markdown to lkbPickerSink instead
// of the (absent) editor textarea.
function lkbPickMaterial() {
  window.lkbPickerSink = async md => {
    const lick = lkb.lick;
    if (!lick) return;
    const notes = (lick.notes ? lick.notes.replace(/\s*$/, '') + '\n\n' : '') + md.trim() + '\n';
    try {
      const saved = await api(`/api/licks/${lick.id}`, 'PUT', { notes });
      lick.notes = saved.notes;
      const cached = licksState.licksById[lick.id];
      if (cached) cached.notes = saved.notes;
      // A previously removed copy of the same material would stay hidden.
      lkb.layout.hidden = [];
      lkbRebuild();
    } catch (e) { alert('添加素材失败：' + e.message); }
  };
  openMaterialPicker();
}

// ── Pointer interaction ──

function lkbFreeze(on) {
  document.querySelectorAll('#lkb-canvas iframe, #lkb-canvas video').forEach(f => { f.style.pointerEvents = on ? 'none' : ''; });
}

function lkbStartDrag(e, el, mode) {
  if (e.button !== 0) return;
  e.preventDefault();
  const cv = lkb.canvas, blocks = lkb.layout.blocks;
  const bb = lkbEntry(el.dataset.bid);
  if (!bb) return;
  const u = lkbUnit();
  const x0 = e.clientX, y0 = e.clientY, ox = bb.x * u, oy = bb.y, w0 = bb.w * u, h0 = bb.h;
  const move = mode === 'move';
  const ph = document.createElement('div');
  ph.className = 'lkb-ph';
  cv.appendChild(ph);
  lkbPlace(ph, bb);
  if (move) el.classList.add('lift');
  lkbFreeze(true);
  document.body.style.cursor = move ? 'grabbing' : getComputedStyle(e.currentTarget).cursor;
  const cur = { x: bb.x, y: bb.y, w: bb.w, h: bb.h };
  let last = '', raf = 0, lastEv = e, done = false;

  const calc = ev => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (move) {
      cur.x = Math.max(0, Math.min(LKB_COLS - bb.w, Math.round((ox + dx) / u)));
      cur.y = Math.max(0, Math.round((oy + dy) / LKB_SNAP) * LKB_SNAP);
    } else {
      if (mode.l) {   // left edge: the right edge stays put, x and w change together
        const right = bb.x + bb.w;
        cur.x = Math.max(0, Math.min(right - LKB_MINW, Math.round((ox + dx) / u)));
        cur.w = right - cur.x;
      }
      if (mode.x) cur.w = Math.max(LKB_MINW, Math.min(LKB_COLS - bb.x, Math.round((w0 + dx) / u)));
      if (mode.y) cur.h = Math.max(LKB_MIN_H, Math.round((h0 + dy) / LKB_SNAP) * LKB_SNAP);
    }
  };
  // Only when the snapped cell changes: dashed placeholder + live push-aside
  // of the other blocks (positions only, contents are never re-rendered).
  const preview = () => {
    const k = `${cur.x},${cur.y},${cur.w},${cur.h}`;
    if (k === last) return;
    last = k;
    lkbPlace(ph, cur);
    const copy = blocks.map(b => ({ ...b })), f = copy.find(b => b.id === bb.id);
    Object.assign(f, cur);
    lkbResolve(f, copy);
    copy.forEach(c => {
      if (c.id === bb.id) return;
      const o = cv.querySelector(`[data-bid="${CSS.escape(c.id)}"]`);
      if (o) lkbPlace(o, c);
    });
  };
  const onMove = ev => {
    lastEv = ev;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (move) el.style.transform = `translate(${lastEv.clientX - x0}px,${lastEv.clientY - y0}px)`;
      calc(lastEv);
      preview();
    });
  };
  const finish = commit => {
    if (done) return;
    done = true;
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onCancel);
    removeEventListener('blur', onCancel);
    removeEventListener('keydown', onKey);
    cancelAnimationFrame(raf);
    ph.remove();
    lkbFreeze(false);
    document.body.style.cursor = '';
    if (commit) { Object.assign(bb, cur); lkbResolve(bb, blocks); lkbSave(); }
    if (move && commit) {
      el.style.transition = 'transform .12s ease-out';
      el.style.transform = `translate(${cur.x * u - ox}px,${cur.y - oy}px)`;
      // Land left/top at the destination without animation and drop the
      // transform, only then restore the transition — otherwise the block
      // animates from its old spot once more (visible "snap back" jitter).
      setTimeout(() => {
        el.style.transition = 'none';
        el.classList.remove('lift');
        lkbPlace(el, bb);
        el.style.transform = '';
        void el.offsetWidth;
        el.style.transition = '';
        lkbFit();
      }, 130);
    } else {
      el.style.transform = '';
      el.classList.remove('lift');
      lkbFit();
    }
  };
  const onUp = ev => { calc(ev); finish(true); };
  const onCancel = () => finish(false);
  const onKey = ev => { if (ev.key === 'Escape') finish(false); };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onCancel);
  addEventListener('blur', onCancel);
  addEventListener('keydown', onKey);
}

function lkbBindBlocks() {
  lkb.canvas.querySelectorAll('.lkb-blk').forEach(el => {
    const bid = el.dataset.bid;
    el.querySelector('.lkb-h').onpointerdown = e => {
      if (e.target.closest('button,select,input')) return;
      lkbStartDrag(e, el, 'move');
    };
    el.querySelector('.lkb-rl').onpointerdown = e => { e.stopPropagation(); lkbStartDrag(e, el, { l: 1 }); };
    el.querySelector('.lkb-rr').onpointerdown = e => { e.stopPropagation(); lkbStartDrag(e, el, { x: 1 }); };
    el.querySelector('.lkb-rb').onpointerdown = e => { e.stopPropagation(); lkbStartDrag(e, el, { y: 1 }); };
    el.querySelector('.lkb-rc').onpointerdown = e => { e.stopPropagation(); lkbStartDrag(e, el, { x: 1, y: 1 }); };
    el.querySelector('.lkb-h').onclick = e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const b = lkbEntry(bid);
      if (act === 'dup') lkbDup(bid);
      else if (act === 'del') lkbDel(bid);
      else if (act === 'prev') lkbSetPage(bid, (b.page || 1) - 1);
      else if (act === 'next') lkbSetPage(bid, (b.page || 1) + 1);
    };
    el.querySelector('.lkb-h').onchange = e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'src') lkbSetSrc(bid, t.value);
      else if (t.dataset.act === 'page') lkbSetPage(bid, t.value);
    };
  });
}

let lkbResizeTimer = 0, lkbWasEnabled = lkbEnabled();
addEventListener('resize', () => {
  clearTimeout(lkbResizeTimer);
  lkbResizeTimer = setTimeout(() => {
    const on = lkbEnabled();
    if (on !== lkbWasEnabled) {
      lkbWasEnabled = on;
      const lick = licksState.currentLick;
      if (lick && document.getElementById('lick-detail-content')?.children.length) renderLickDetail(lick);
    } else if (on && document.getElementById('lkb-canvas')) lkbFit();
  }, 150);
});

// ── Floating practice window ──
// The metronome panel (#st-panel) is homed into #lick-practice-slot by
// licksSyncPracticePanelHome(); on the board page that slot is a free-floating,
// draggable window that can collapse to a strip. Position/collapsed state is
// a pure UI convenience → localStorage (lick_practice_win).
const LKW_KEY = 'lick_practice_win';
function lkwLoad() {
  try {
    const v = JSON.parse(localStorage.getItem(LKW_KEY));
    return { x: Number.isFinite(v?.x) ? v.x : null, y: Number.isFinite(v?.y) ? v.y : null, collapsed: v?.collapsed === true, open: v?.open !== false,
      w: Number.isFinite(v?.w) ? v.w : null, h: Number.isFinite(v?.h) ? v.h : null, more: v?.more === true };
  } catch (_) { return { x: null, y: null, collapsed: false, open: true, w: null, h: null, more: false }; }
}
function lkwSave(st) { try { localStorage.setItem(LKW_KEY, JSON.stringify(st)); } catch (_) {} }

// The live window state of the lick currently on screen (null when no lick page is mounted);
// the tools menu toggles open/closed through it so drag/resize saves never write a stale flag.
let lkwCur = null;
function lkwIsAvailable() { return !!(lkwCur && document.querySelector('#lick-practice-slot.lkw')); }
function lkwIsOpen() { return lkwIsAvailable() && lkwCur.open; }
function lkwSetOpen(open) {
  const slot = document.querySelector('#lick-practice-slot.lkw');
  if (!slot || !lkwCur) return;
  lkwCur.open = open;
  lkwApply(slot, lkwCur);
  lkwSave(lkwCur);
}

function lkwApply(slot, st) {
  slot.classList.toggle('closed', !st.open);
  slot.classList.toggle('collapsed', st.collapsed);
  slot.style.width = st.w && !st.collapsed ? Math.max(320, Math.min(window.innerWidth - 16, st.w)) + 'px' : '';
  // Height is intentionally not restored: the compact window sizes to its content (a stale saved height would keep it tall).
  slot.style.height = '';
  const w = slot.offsetWidth || 440;

  const x = st.x == null ? window.innerWidth - w - 24 : st.x;
  const y = st.y == null ? 130 : st.y;
  slot.style.left = Math.max(0, Math.min(window.innerWidth - w - 8, x)) + 'px';
  slot.style.top = Math.max(0, Math.min(window.innerHeight - 40, y)) + 'px';
  const btn = slot.querySelector('.lkw-toggle');
  if (btn) btn.textContent = st.collapsed ? '▸' : '▾';
}

function lkbInitPracticeWindow() {
  const slot = document.getElementById('lick-practice-slot');
  if (!slot) return;
  const st = lkwCur = lkwLoad();
  slot.classList.add('lkw');
  slot.insertAdjacentHTML('afterbegin',
    '<div class="lkw-h" title="拖动到任意位置"><span class="lkw-grip">⠿</span><b>Speed Trainer</b><span class="lkw-live"></span><button class="lkw-toggle agent-icon-btn" title="收起 / 展开"></button><button class="lkw-close agent-icon-btn" title="关闭">✕</button></div>');
  const head = slot.querySelector('.lkw-h');
  lkwApply(slot, st);
  // "节拍与提速设置" fold: remembered across reloads (reassigning ontoggle keeps this idempotent across lick switches).
  const more = document.getElementById('st-more');
  if (more) { more.open = st.more; more.ontoggle = () => { st.more = more.open; lkwSave(st); }; }
  // Drag the bottom-right corner (CSS resize) to size the window; remember it.
  let first = true, t = 0;
  new ResizeObserver(() => {
    if (first) { first = false; return; }
    if (slot.classList.contains('collapsed') || !slot.offsetWidth) return;
    clearTimeout(t);
    t = setTimeout(() => { st.w = Math.round(slot.offsetWidth); st.h = Math.round(slot.offsetHeight); lkwSave(st); }, 300);
  }).observe(slot);
  if (typeof stRefreshLive === 'function') stRefreshLive();
  head.querySelector('.lkw-close').onclick = () => lkwSetOpen(false);
  head.querySelector('.lkw-toggle').onclick = () => { st.collapsed = !st.collapsed; lkwApply(slot, st); lkwSave(st); };
  head.onpointerdown = e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, r = slot.getBoundingClientRect();
    const move = ev => { st.x = r.left + ev.clientX - x0; st.y = r.top + ev.clientY - y0; lkwApply(slot, st); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); lkwSave(st); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lkb, lkbNormalizeLayout, lkbReconcile, lkbPlaceNew, lkbResolve, lkbOverlap, lkbDefaultSize, lkbBottom };
}
