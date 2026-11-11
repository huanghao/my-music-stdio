// Lick detail "material board": the lick's materials (notes text, PDFs, score
// images, videos, audio players, links) as blocks on a canvas.
//
// - Sources are derived from the lick (score_images / demo_url / pdf_url /
//   source_url) and from the rendered notes (embeds are lifted out of the
//   text). The notes Markdown stays the single source of truth for WHICH
//   materials exist; `lick.layout` only stores WHERE they sit.
// - Viewing is chrome-free. "✎ 排版" (a button in the lick header) shows a thin strip on every block
//   (drag handle, width shortcuts, fit-to-content, remove) and the resize edges.
// - Blocks are always packed upward / leftward; a block's height follows its content unless the user
//   pulled its bottom edge. Dropping a block below everything makes it full width; dropping it on the
//   left / right edge of another block splits that block in two.
// Below LKB_MIN_WIDTH px the page falls back to the old single-column layout.

const LKB_COLS = 120, LKB_MINW = 20, LKB_GAP = 10, LKB_SNAP = 10, LKB_MIN_WIDTH = 900;
const LKB_MIN_H = 80;
const LKB_ICON = { pdf: '📄', img: '🖼', video: '🎬', audio: '🎧', text: '📝', link: '🔗' };

const lkb = { lick: null, sources: new Map(), layout: null, canvas: null, saveTimer: null, nat: new Map(), hist: [], drag: null, busy: false, edit: false, floats: {} };

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
// Stored per lick (lick.layout): { v:1, hidden:[sourceId], blocks:[{id, of, x, y, w, h, page, fit?}] }.
// x/w are in 1/LKB_COLS of the canvas width, y/h in px. Blocks are always packed upward and leftward
// (lkbCompact), so there are no stray gaps; a block's height follows its content ("fit") unless the user
// pulled its bottom edge (fit:false) — PDFs never fit, they keep the height set by hand.

const LKB_XSNAP = 10;   // horizontal drop / resize step in columns (1/12 of the width)
const LKB_WIDTHS = [[40, '⅓'], [60, '½'], [80, '⅔'], [120, '整行']];
const LKB_FIT_MAX_VIDEO = 520;

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
          ...(b.fit === true || b.fit === false ? { fit: b.fit } : {}),
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
  const ids = new Set(L.blocks.map(b => b.id));
  for (const id of Object.keys(lkb.floats)) if (!ids.has(id)) delete lkb.floats[id];
}

const lkbHit = (a, p) => a.x < p.x + p.w && p.x < a.x + a.w && a.y < p.y + p.h + LKB_GAP && p.y < a.y + a.h + LKB_GAP;

// Packs items upward, then leftward, then upward again, in (y, x) order. Pure: returns new items
// {id, x, y, w, h}; a block never ends up overlapping (or touching, vertically) an earlier one.
function lkbCompact(items) {
  const list = items.map(i => ({ ...i })).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];
  const up = it => {
    let y = 0;
    for (const p of placed) if (it.x < p.x + p.w && p.x < it.x + it.w) y = Math.max(y, p.y + p.h + LKB_GAP);
    it.y = y;
  };
  for (const it of list) {
    up(it);
    while (it.x > 0 && !placed.some(p => lkbHit({ ...it, x: it.x - 1 }, p))) it.x--;
    up(it);
    placed.push(it);
  }
  return list;
}

// A block that got wider pushes the blocks it now overlaps to its right (narrowing them only when they
// would run off the edge) instead of letting compaction drop them to the next row. Mutates `items`.
function lkbShiftRight(items, fixed) {
  const q = [fixed];
  for (let guard = 0; q.length && guard < 200; guard++) {
    const a = q.shift();
    for (const o of items) {
      if (o === a || o === fixed || !lkbHit(a, o) || o.x >= a.x + a.w || o.x <= a.x) continue;   // o.x <= a.x: stacked below / above, not a right neighbour
      const nx = a.x + a.w;
      if (nx + LKB_MINW > LKB_COLS) continue;          // no room at all: compaction will stack it below
      o.x = nx;
      if (o.x + o.w > LKB_COLS) o.w = LKB_COLS - o.x;
      q.push(o);
    }
  }
}

// Dropping onto the left / right edge of a block splits it: `b` takes `half` columns beside `T`.
function lkbDock(T, b, side) {
  const half = Math.max(1, Math.floor(T.w / 2));
  if (side === 'L') { b.x = T.x; T.x += half; } else { b.x = T.x + T.w - half; }
  T.w -= half; b.w = half; b.y = T.y;
}

// ── Sources → blocks ──

const lkbIsFit = (b, src) => !!src && src.kind !== 'pdf' && b.fit !== false;
function lkbUnit() { return lkb.canvas.clientWidth / LKB_COLS; }
function lkbEntry(bid) { return lkb.layout.blocks.find(b => b.id === bid); }
function lkbVisible() { return lkb.layout.blocks.filter(b => lkb.sources.has(b.of) && !lkb.floats[b.id]); }

// Pixel height of a block at the current canvas width.
function lkbHeight(b, u) {
  const src = lkb.sources.get(b.of);
  if (!lkbIsFit(b, src)) return b.h;
  const w = b.w * u - LKB_GAP;
  if (src.kind === 'video') return Math.min(LKB_FIT_MAX_VIDEO, Math.round(w * 9 / 16));
  if (src.kind === 'img') { const n = lkb.nat.get(src.href); if (n && n.w) return Math.round(w * n.h / n.w); }
  return b._nh || 120;   // measured natural height of the content (see lkbMeasure)
}

// ── Persistence ──

function lkbSave() {
  clearTimeout(lkb.saveTimer);
  lkb.saveTimer = setTimeout(async () => {
    const lick = lkb.lick;
    if (!lick) return;
    const layout = JSON.parse(JSON.stringify(lkb.layout, (k, v) => (k[0] === '_' ? undefined : v)));
    try {
      await api(`/api/licks/${lick.id}`, 'PUT', { layout });
      lick.layout = layout;
      const cached = licksState.licksById[lick.id];
      if (cached) cached.layout = layout;
    } catch (e) { console.warn('failed to save lick layout:', e); }
  }, 400);
}

// ── Undo (in memory, per page visit) ──

function lkbSnapshot() { return JSON.stringify(lkb.layout, (k, v) => (k[0] === '_' ? undefined : v)); }
function lkbPush() { lkb.hist.push(lkbSnapshot()); if (lkb.hist.length > 60) lkb.hist.shift(); lkbRenderBar(); }
function lkbUndo() {
  const s = lkb.hist.pop();
  if (!s) return;
  lkb.layout = lkbNormalizeLayout(JSON.parse(s));
  lkbSave();
  lkbRender();
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
    case 'text': return `<div class="lkb-pad lick-notes-md lkb-text">${src.html}</div><button class="lkb-editnote" data-act="editnotes" title="在编辑页修改笔记">✎ 编辑</button>`;
  }
  return '';
}

// The strip only exists in 排版 mode (CSS hides it otherwise): drag handle, name / source picker,
// PDF pager, width shortcuts, fit-to-content, remove.
function lkbStripHtml(entry, src) {
  const same = [...lkb.sources.values()].filter(s => s.kind === src.kind && s.kind !== 'text');
  const title = same.length > 1
    ? `<select data-act="src" title="换一份素材">${same.map(s => `<option value="${htmlEsc(s.id)}"${s.id === entry.of ? ' selected' : ''}>${htmlEsc(s.title)}</option>`).join('')}</select>`
    : `<b title="${htmlEsc(src.title)}">${LKB_ICON[src.kind] || ''} ${htmlEsc(src.title)}</b>`;
  const pager = src.kind === 'pdf'
    ? `<span class="lkb-pp"><button data-act="prev" title="上一页">◀</button><input data-act="page" value="${entry.page || 1}"><button data-act="next" title="下一页">▶</button></span>` : '';
  const wb = LKB_WIDTHS.map(([w, l]) => `<button data-w="${w}" title="宽度 ${l}">${l}</button>`).join('');
  return `<div class="lkb-strip"><span class="lkb-grip" title="拖动">⋮⋮</span>${title}${pager}<span class="lkb-sp">` +
    `<span class="lkb-wbar">${wb}</span>` +
    (LKF_KINDS.includes(src.kind) ? `<button class="lkb-chip" data-act="float" title="浮动到右侧工具坞，板上不占位">⇱ 浮动</button>` : '') +
    (src.kind === 'pdf' ? `<button class="lkb-chip" data-act="dup" title="再开一页放在旁边">＋页</button>`
      : `<button class="lkb-chip lkb-fitbtn" data-act="fit" title="高度跟随内容；拖下边缘改高度后变固定，点这里恢复">贴合</button>`) +
    `<button class="lkb-x" data-act="del" title="从看板移除（素材本身不会删除，可在“添加素材”或上方找回）">×</button></span></div>`;
}

function lkbBlockHtml(b) {
  const src = lkb.sources.get(b.of);
  return `<div class="lkb-blk lkb-${src.kind}" data-bid="${htmlEsc(b.id)}"><div class="lkb-body"><div class="lkb-nat">${lkbBodyHtml(b, src)}</div></div>` +
    `${LKF_KINDS.includes(src.kind) ? '<button class="lkb-float" data-act="float" title="浮动到工具坞">⇱</button>' : ''}` +
    `${lkbStripHtml(b, src)}<div class="lkb-rr"></div><div class="lkb-rb"></div><div class="lkb-rc"></div></div>`;
}

function lkbRender() {
  const cv = lkb.canvas;
  licksAudioStopAll();
  const blocks = lkbVisible();
  cv.innerHTML = blocks.map(lkbBlockHtml).join('') + '<div class="lkb-ph" id="lkb-ph" hidden></div><div class="lkb-dock" id="lkb-dock" hidden></div>';
  if (!blocks.length && Object.keys(lkb.floats).length) {
    cv.innerHTML = '<div class="lkb-empty"><p class="empty-state">素材都浮动到工具坞了 — 点坞里的圆点打开，右键圆点放回</p></div>';
    cv.style.height = '';
  } else if (!blocks.length) {
    cv.innerHTML = `<div class="lkb-empty"><p class="empty-state">还没有素材 — 点右上角的“＋ 添加素材”</p>
      <div><button class="btn" onclick="lkbPickMaterial()">📎 上传 / 从素材库选择</button>
      <button class="btn btn-ghost" onclick="navOpenLickEdit('${htmlEsc(lkb.lick.id)}')">📝 写笔记</button></div></div>`;
    cv.style.height = '';
  }
  lkbPreloadImages();
  lkbObserveContent();
  lkbApplyPos();
  lkbWatchTracks();
  lkbRenderMenu();
  lkbRenderBar();
}

// Natural size of score images drives their fitted height.
function lkbPreloadImages() {
  for (const s of lkb.sources.values()) {
    if (s.kind !== 'img' || lkb.nat.has(s.href)) continue;
    lkb.nat.set(s.href, null);
    const im = new Image();
    im.onload = () => { lkb.nat.set(s.href, { w: im.naturalWidth, h: im.naturalHeight }); if (lkb.canvas) lkbApplyPos(); };
    im.src = s.href;
  }
}

// Text / audio / link blocks fit their measured content height; observe it (text wraps when the
// width changes, a playing track expands) and re-pack when it changes.
function lkbObserveContent() {
  if (lkb.cro) lkb.cro.disconnect();
  let raf = 0;
  lkb.cro = new ResizeObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (lkbMeasure()) lkbApplyPos(false); });
  });
  lkb.canvas.querySelectorAll('.lkb-nat').forEach(n => lkb.cro.observe(n));
}
function lkbMeasure() {
  let changed = false;
  for (const el of lkb.canvas.querySelectorAll('.lkb-blk')) {
    const b = lkbEntry(el.dataset.bid), src = b && lkb.sources.get(b.of);
    if (!lkbIsFit(b, src) || src.kind === 'video' || src.kind === 'img') continue;
    const nh = Math.ceil(el.querySelector('.lkb-nat').offsetHeight) + 2;
    if (nh !== b._nh) { b._nh = nh; changed = true; }
  }
  return changed;
}

// Packs the blocks (writing x / y back into the layout) and places the elements.
// `dragId` = the block being dragged: its element follows the pointer, the others are left alone.
function lkbApplyPos(measure = true, activeId = null) {
  const cv = lkb.canvas;
  if (!cv || !lkb.layout) return;
  if (measure) lkbMeasure();
  const u = lkbUnit(), blocks = lkbVisible();
  const raw = blocks.map(b => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: lkbHeight(b, u) }));
  const active = activeId && raw.find(i => i.id === activeId);
  if (active) lkbShiftRight(raw, active);
  const items = lkbCompact(raw);
  let bottom = 0;
  for (const it of items) {
    const b = lkbEntry(it.id);
    b.x = it.x; b.y = it.y; b.w = it.w; b._h = it.h;
    bottom = Math.max(bottom, it.y + it.h);
    const el = cv.querySelector(`[data-bid="${CSS.escape(it.id)}"]`);
    if (!el) continue;
    if (lkb.drag && lkb.drag.id === it.id) {
      const ph = document.getElementById('lkb-ph');
      if (ph) Object.assign(ph.style, { left: it.x * u + 'px', top: it.y + 'px', width: it.w * u - LKB_GAP + 'px', height: it.h + 'px' });
      continue;
    }
    Object.assign(el.style, { left: it.x * u + 'px', top: it.y + 'px', width: it.w * u - LKB_GAP + 'px', height: it.h + 'px' });
    el.querySelectorAll('.lkb-wbar button').forEach(btn => btn.classList.toggle('on', +btn.dataset.w === b.w));
    el.querySelector('.lkb-fitbtn')?.classList.toggle('on', lkbIsFit(b, lkb.sources.get(b.of)));
  }
  cv.style.height = blocks.length ? Math.max(240, bottom) + 60 + 'px' : '';
}

// ── 排版 mode ──

function lkbHostHtml() {
  return `<section class="lkb" id="lkb-root" aria-label="素材面板">
    <div class="lkb-bar" id="lkb-bar"></div>
    <div class="lkb-canvas" id="lkb-canvas"></div>
  </section>`;
}

// The two buttons in the lick header row: 排版 toggle + add-material menu.
function lkbMenuHtml() {
  return `<button class="btn btn-sm" id="lkb-edit-btn" onclick="lkbToggleEdit()" title="拖动、改宽度、隐藏；平时不需要">✎ 排版</button>` +
    `<div class="lkb-menu" id="lkb-menu"><button class="btn btn-sm" onclick="lkbToggleMenu()" title="添加素材 / 找回隐藏的素材">＋ 添加素材 ▾</button><div class="lkb-pop" id="lkb-pop"></div></div>`;
}

function lkbSetEdit(on) {
  lkb.edit = on;
  document.getElementById('lkb-root')?.classList.toggle('editing', on);
  document.getElementById('lkb-edit-btn')?.classList.toggle('on', on);
  lkbRenderBar();
}
function lkbToggleEdit() { lkbSetEdit(!lkb.edit); }

function lkbRenderBar() {
  const bar = document.getElementById('lkb-bar');
  if (!bar || !lkb.layout) return;
  const hidden = lkb.layout.hidden.map(id => lkb.sources.get(id)).filter(Boolean);
  bar.innerHTML = `<span class="lkb-bar-t">排版中</span>` +
    `<span class="lkb-bar-tip">拖到最下面空白处变整行 · 拖到别的块左 / 右边缘各占一半</span>` +
    `<button class="btn btn-sm" data-act="undo"${lkb.hist.length ? '' : ' disabled'}>↶ 撤销</button>` +
    (hidden.length ? `<span class="lkb-bar-h">已隐藏${hidden.map(s => `<button data-restore="${htmlEsc(s.id)}" title="重新显示">＋ ${LKB_ICON[s.kind] || ''} ${htmlEsc(s.title)}</button>`).join('')}</span>` : '') +
    `<button class="btn btn-sm lkb-done" data-act="done">完成</button>`;
}

// ── Menu (＋ 添加素材) ──

function lkbToggleMenu() { document.getElementById('lkb-menu')?.classList.toggle('open'); }
document.addEventListener('click', e => {
  const m = document.getElementById('lkb-menu');
  if (m && m.classList.contains('open') && !m.contains(e.target)) m.classList.remove('open');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('lkb-menu')?.classList.remove('open');
    if (lkb.edit && !lkb.busy && !e.target.closest('input,textarea,select')) lkbSetEdit(false);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && lkb.edit && document.getElementById('lkb-canvas') && !e.target.closest('input,textarea,select')) {
    e.preventDefault();
    lkbUndo();
  }
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
  lkbPush();
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

// ── Mount ──

function lkbMount(lick) {
  const root = document.getElementById('lkb-canvas');
  if (!root) return;
  lkb.lick = lick;
  lkb.canvas = root;
  lkb.hist = [];
  lkb.drag = null; lkb.busy = false;
  // Page-width preference / sidebar changes resize the canvas without a window resize.
  if (lkb.ro) lkb.ro.disconnect();
  lkb.ro = new ResizeObserver(() => { if (lkb.canvas === root && lkb.layout) lkbApplyPos(); });
  lkb.ro.observe(root);
  lkb.layout = lkbNormalizeLayout(lick.layout);
  lkb.floats = lkfLoad(lick.id);
  lkbBindEvents();
  lkbRebuild();
  lkfSync();
  lkbSetEdit(false);
  lkbInitPracticeWindow();
}

// Re-collects sources (the notes may have changed) and redraws every block.
function lkbRebuild() {
  const { sources } = lkbCollectSources(lkb.lick);
  lkb.sources = new Map(sources.map(s => [s.id, s]));
  lkbReconcile();
  lkbRender();
}

// ── Actions ──

function lkbSetWidth(b, w) {
  lkbPush();
  b.w = w;
  if (b.x + b.w > LKB_COLS) b.x = LKB_COLS - b.w;
  lkbSave();
  lkbApplyPos(true, b.id);
}

function lkbToggleFit(b) {
  lkbPush();
  if (lkbIsFit(b, lkb.sources.get(b.of))) { b.h = Math.max(LKB_MIN_H, Math.round(b._h)); b.fit = false; }
  else b.fit = true;
  lkbSave();
  lkbApplyPos();
}

function lkbDup(bid) {
  const b = lkbEntry(bid);
  if (!b) return;
  lkbPush();
  let n = 2;
  while (lkbEntry(`${b.of}~${n}`)) n++;
  const e = { ...b, id: `${b.of}~${n}`, page: (b.page || 1) + 1 };
  e.x = b.x + b.w * 2 <= LKB_COLS ? b.x + b.w : b.x;
  e.y = b.y + (e.x === b.x ? b.h + LKB_GAP : 0);
  lkb.layout.blocks.push(e);
  lkbSave();
  lkbRender();
}

function lkbDel(bid) {
  const L = lkb.layout;
  const b = lkbEntry(bid);
  if (!b) return;
  lkbPush();
  L.blocks = L.blocks.filter(x => x.id !== bid);
  if (!L.blocks.some(x => x.of === b.of) && !L.hidden.includes(b.of)) L.hidden.push(b.of);
  lkbSave();
  lkbRender();
}

function lkbSetSrc(bid, srcId) {
  const b = lkbEntry(bid);
  if (!b || !lkb.sources.has(srcId)) return;
  lkbPush();
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

// ── Pointer interaction (only in 排版 mode) ──

function lkbFreeze(on) {
  document.querySelectorAll('#lkb-canvas iframe, #lkb-canvas video').forEach(f => { f.style.pointerEvents = on ? 'none' : ''; });
}

function lkbBindEvents() {
  const cv = lkb.canvas;
  cv.onclick = e => {
    const el = e.target.closest('.lkb-blk');
    if (!el) return;
    const b = lkbEntry(el.dataset.bid);
    if (!b) return;
    const wbtn = e.target.closest('.lkb-wbar button');
    if (wbtn) { lkbSetWidth(b, +wbtn.dataset.w); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fit') lkbToggleFit(b);
    else if (act === 'del') lkbDel(b.id);
    else if (act === 'float') lkfFloat(b.id);
    else if (act === 'dup') lkbDup(b.id);
    else if (act === 'prev') lkbSetPage(b.id, (b.page || 1) - 1);
    else if (act === 'next') lkbSetPage(b.id, (b.page || 1) + 1);
    else if (act === 'editnotes') navOpenLickEdit(lkb.lick.id);
  };
  cv.onchange = e => {
    const t = e.target.closest('[data-act]');
    const el = e.target.closest('.lkb-blk');
    if (!t || !el) return;
    if (t.dataset.act === 'src') lkbSetSrc(el.dataset.bid, t.value);
    else if (t.dataset.act === 'page') lkbSetPage(el.dataset.bid, t.value);
  };
  cv.onpointerdown = e => {
    if (!lkb.edit || e.button !== 0) return;
    const el = e.target.closest('.lkb-blk');
    if (!el || e.target.closest('button,select,input')) return;
    const mode = e.target.closest('.lkb-rc') ? 'c' : e.target.closest('.lkb-rr') ? 'r' : e.target.closest('.lkb-rb') ? 'b' : 'move';
    lkbStartDrag(e, el, mode);
  };
  const bar = document.getElementById('lkb-bar');
  if (bar) bar.onclick = e => {
    const r = e.target.closest('[data-restore]');
    if (r) { lkbRestore(r.dataset.restore); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'undo') lkbUndo();
    else if (act === 'done') lkbSetEdit(false);
  };
}

// While a block is dragged the other blocks stay frozen (so drop targets do not slide away), a dashed
// placeholder shows where it would land, and the real re-packing happens on release.
function lkbStartDrag(e, el, mode) {
  e.preventDefault();
  const cv = lkb.canvas, b = lkbEntry(el.dataset.bid);
  if (!b) return;
  lkbPush();
  const r = el.getBoundingClientRect();
  const st = { id: b.id, mode, gx: e.clientX - r.left, gy: e.clientY - r.top, ow: b.w, dock: null };
  lkb.busy = true;
  lkb.drag = mode === 'move' ? st : null;   // only a moved block follows the pointer; resized ones stay laid out
  const others = lkbVisible().filter(o => o.id !== b.id);
  const ph = document.getElementById('lkb-ph'), dk = document.getElementById('lkb-dock');
  if (mode === 'move') { el.classList.add('lift'); ph.hidden = false; }
  lkbFreeze(true);
  document.body.style.cursor = mode === 'move' ? 'grabbing' : getComputedStyle(e.target).cursor;
  let done = false, raf = 0, last = e, scrollRaf = 0;

  const move = ev => {
    if (ev.buttons === 0) return up(ev);           // released outside the page
    last = ev;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; step(last); });
  };
  const step = ev => {
    const cr = cv.getBoundingClientRect();   // re-measured: the page may have scrolled while dragging
    const u = lkbUnit(), px = ev.clientX - cr.left, py = ev.clientY - cr.top;
    if (mode !== 'move') {
      if (mode === 'r' || mode === 'c') {
        b.w = Math.max(LKB_MINW, Math.min(LKB_COLS - b.x, Math.round(((px + LKB_GAP) / u - b.x) / 5) * 5));
      }
      if (mode === 'b' || mode === 'c') { b.h = Math.max(LKB_MIN_H, Math.round((py - b.y) / LKB_SNAP) * LKB_SNAP); b.fit = false; }
      lkbApplyPos(false, b.id);
      return;
    }
    el.style.left = px - st.gx + 'px';
    el.style.top = py - st.gy + 'px';
    st.dock = null; dk.hidden = true;
    const T = others.find(o => px >= o.x * u && px <= (o.x + o.w) * u - LKB_GAP && py >= o.y && py <= o.y + o._h);
    if (T && T.w >= 2 * LKB_MINW) {
      const rel = (px - T.x * u) / (T.w * u), side = rel < 0.3 ? 'L' : rel > 0.7 ? 'R' : null;
      if (side) {
        const half = Math.max(1, Math.floor(T.w / 2)), x0 = side === 'L' ? T.x : T.x + T.w - half;
        st.dock = { T, side };
        Object.assign(dk.style, { left: x0 * u + 'px', top: T.y + 'px', width: half * u - LKB_GAP + 'px', height: T._h + 'px' });
        dk.textContent = '各占一半'; dk.hidden = false; ph.hidden = true;
        return;
      }
    }
    ph.hidden = false;
    const bottom = others.reduce((m, o) => Math.max(m, o.y + o._h), 0);
    if (py - st.gy > bottom + 24) { b.w = LKB_COLS; b.x = 0; }
    else { b.w = st.ow; b.x = Math.max(0, Math.min(LKB_COLS - b.w, Math.round((px - st.gx) / u / LKB_XSNAP) * LKB_XSNAP)); }
    b.y = Math.max(0, Math.round(py - st.gy));
    // where it would land (the others are not moved yet)
    const me = lkbCompact([...others.map(o => ({ id: o.id, x: o.x, y: o.y, w: o.w, h: o._h })), { id: b.id, x: b.x, y: b.y, w: b.w, h: b._h }]).find(i => i.id === b.id);
    Object.assign(ph.style, { left: me.x * u + 'px', top: me.y + 'px', width: me.w * u - LKB_GAP + 'px', height: me.h + 'px' });
  };
  // Near the top / bottom edge of the window the page scrolls, so the bottom of a long board is reachable.
  const autoScroll = () => {
    if (done) return;
    const y = last.clientY, edge = 70;
    const dy = y > innerHeight - edge ? Math.min(28, (y - (innerHeight - edge)) / 2 + 4) : y < edge ? -Math.min(28, (edge - y) / 2 + 4) : 0;
    if (dy) { scrollBy(0, dy); step(last); }
    scrollRaf = requestAnimationFrame(autoScroll);
  };
  scrollRaf = requestAnimationFrame(autoScroll);
  const finish = commit => {
    if (done) return;
    done = true;
    cancelAnimationFrame(scrollRaf);
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    removeEventListener('pointercancel', cancel); removeEventListener('blur', cancel); removeEventListener('keydown', key);
    cancelAnimationFrame(raf);
    if (commit && st.dock) lkbDock(st.dock.T, b, st.dock.side);
    lkb.drag = null; lkb.busy = false;
    el.classList.remove('lift'); el.style.left = el.style.top = '';
    ph.hidden = true; dk.hidden = true;
    lkbFreeze(false);
    document.body.style.cursor = '';
    if (commit) { lkbApplyPos(false); lkbSave(); lkbRenderBar(); }
    else lkbUndo();   // restores the layout from before the drag
  };
  const up = ev => { step(ev); finish(true); };
  const cancel = () => finish(false);
  const key = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); finish(false); } };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
  addEventListener('pointercancel', cancel); addEventListener('blur', cancel); addEventListener('keydown', key);
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
    } else if (on && document.getElementById('lkb-canvas')) lkbApplyPos();
  }, 150);
});

// A track row counts as "on" while its toggle shows ⏸ (the audio code flips
// the button text on play/pause/end), so watch the text rather than hook events.
function lkbSyncTracks() {
  document.querySelectorAll('.lkb-trk').forEach(r =>
    r.classList.toggle('on', r.querySelector('.lick-audio-toggle')?.textContent.trim() === '⏸'));
}
function lkbWatchTracks() {
  if (lkb.mo) lkb.mo.disconnect();
  // Observe only each track's play button (not the whole canvas): the time
  // readouts rewrite their text several times a second while playing.
  lkb.mo = new MutationObserver(lkbSyncTracks);
  document.querySelectorAll('.lkb-trk .lick-audio-toggle').forEach(b =>
    lkb.mo.observe(b, { childList: true, characterData: true, subtree: true }));
  lkbSyncTracks();
}


// ── Floating blocks (audio / video → edge dock) ──
// A block can be floated out of the board into its own window, opened from a dot at the bottom of the edge
// dock (dock.js). The block stays in lick.layout (so putting it back keeps its source and size) but is skipped
// by the board packing while floated. Floated set + window geometry are UI convenience → localStorage
// `lick_floats` = { [lickId]: { [blockId]: { x, y, w, open } } }.
const LKF_KEY = 'lick_floats';
const LKF_KINDS = ['audio', 'video'];
const LKF_ICON = { audio: 'au', video: 'vi' };

function lkfReadAll() {
  try { const v = JSON.parse(localStorage.getItem(LKF_KEY)); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
}
function lkfLoad(lickId) {
  const raw = lkfReadAll()[lickId], out = {};
  if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw)) {
      out[id] = { x: Number.isFinite(v?.x) ? v.x : null, y: Number.isFinite(v?.y) ? v.y : null, w: Number.isFinite(v?.w) ? v.w : null, open: v?.open !== false };
    }
  }
  return out;
}
function lkfPersist() {
  if (!lkb.lick) return;
  const all = lkfReadAll();
  if (Object.keys(lkb.floats).length) all[lkb.lick.id] = lkb.floats; else delete all[lkb.lick.id];
  try { localStorage.setItem(LKF_KEY, JSON.stringify(all)); } catch (_) {}
}

const lkfPageActive = () => !!lkb.lick && !!document.getElementById('page-lick-detail')?.classList.contains('active') && !!document.getElementById('lkb-canvas');
const lkfWinEl = bid => document.querySelector(`.dockwin[data-bid="${CSS.escape(bid)}"]`);

function lkfWinHtml(b, src) {
  const body = src.kind === 'video'
    ? (src.file ? `<video controls preload="metadata" src="${htmlEsc(src.href)}"></video>` : src.html)
    : `<div class="lkb-pad">${src.html}</div>`;
  return `<div class="dockwin dockwin-${src.kind}" data-bid="${htmlEsc(b.id)}">` +
    `<div class="dw-h" title="拖动到任意位置"><span class="dw-grip">⠿</span><b>${htmlEsc(src.title)}</b><span class="dw-sp"></span>` +
    `<button class="dw-back" data-dw="back" title="放回板上">⇲ 放回</button><button class="dw-x" data-dw="close" title="收起到工具坞">✕</button></div>` +
    `<div class="dw-body"><div class="lkb-nat lkb-win lkb-win-${src.kind}">${body}</div></div></div>`;
}

function lkfPlace(el, st, bid) {
  let { x, y } = st;
  if (x == null || y == null) {
    const p = dockWinBeside('fl:' + bid, el.offsetWidth || 380, el.offsetHeight || 200);
    x = p.x; y = p.y + 40 * document.querySelectorAll('.dockwin.on').length;   // stagger so new windows don't cover open ones
  }
  dockWinMove(el, x, y);
}

// Rebuilds every floated window of the current lick (mount / re-render).
function lkfSync() {
  document.querySelectorAll('.dockwin').forEach(e => e.remove());
  for (const bid of Object.keys(lkb.floats)) {
    const b = lkbEntry(bid), src = b && lkb.sources.get(b.of);
    if (!src) { delete lkb.floats[bid]; continue; }
    document.body.insertAdjacentHTML('beforeend', lkfWinHtml(b, src));
    const el = lkfWinEl(bid), st = lkb.floats[bid];
    if (st.w) el.style.width = Math.max(300, Math.min(window.innerWidth - 16, st.w)) + 'px';
    lkfBind(el, bid);
  }
  lkfPersist();
  lkbWatchTracks();
  if (typeof dockRefresh === 'function') dockRefresh(); else lkfRefresh();   // dock first: its dots position the windows
}

function lkfBind(el, bid) {
  const st = () => lkb.floats[bid];
  el.addEventListener('click', e => {
    const act = e.target.closest('[data-dw]')?.dataset.dw;
    if (act === 'back') lkfUnfloat(bid);
    else if (act === 'close') lkfSetOpen(bid, false);
  });
  el.addEventListener('pointerdown', () => dockWinRaise(el));
  dockWinDrag(el, el.querySelector('.dw-h'), {
    onMove: (x, y) => { const s = st(); if (s) { s.x = x; s.y = y; } },
    onEnd: lkfPersist,
  });
  dockWinWatchSize(el, w => { if (st()) { st().w = w; lkfPersist(); } });
}

// Shows each window only while its Lick page is on screen and it is open.
function lkfRefresh() {
  const active = lkfPageActive();
  for (const el of document.querySelectorAll('.dockwin')) {
    const st = lkb.floats[el.dataset.bid];
    const show = active && !!st && st.open;
    const was = el.classList.contains('on');
    el.classList.toggle('on', show);
    if (show && !was) lkfPlace(el, st, el.dataset.bid);
  }
}

function lkfSetOpen(bid, open) {
  const st = lkb.floats[bid];
  if (!st) return;
  st.open = open;
  lkfPersist();
  lkfRefresh();
}

function lkfFloat(bid) {
  const b = lkbEntry(bid), src = b && lkb.sources.get(b.of);
  if (!b || !src || !LKF_KINDS.includes(src.kind) || lkb.floats[bid]) return;
  licksAudioStopAll();   // the player DOM is rebuilt in the window; keep UI and audio in step
  lkb.floats[bid] = { x: null, y: null, w: null, open: true };
  lkbRender();
  lkfSync();
  if (typeof dockRefresh === 'function') dockRefresh();   // draws the new dot, then the window opens beside it
  lkfRefresh();
  const el = lkfWinEl(bid);
  if (el) lkfPlace(el, lkb.floats[bid], bid);
}

function lkfUnfloat(bid) {
  const b = lkbEntry(bid);
  if (!b || !lkb.floats[bid]) return;
  licksAudioStopAll();
  delete lkb.floats[bid];
  // Back at the end of the board (its old spot may be taken by now).
  const L = lkb.layout;
  L.blocks = L.blocks.filter(x => x.id !== bid);
  lkbPlaceNew(lkbVisible(), b);
  L.blocks.push(b);
  lkbSave();
  lkbRender();
  lkfSync();
  if (typeof dockRefresh === 'function') dockRefresh();
}

// Dots for dock.js (below the divider). Only while the owning Lick page is showing.
function lkfDockItems() {
  if (!lkfPageActive()) return [];
  const out = [];
  for (const bid of Object.keys(lkb.floats)) {
    const b = lkbEntry(bid), src = b && lkb.sources.get(b.of);
    if (!src) continue;
    out.push({
      id: 'fl:' + bid, icon: LKF_ICON[src.kind], title: src.title,
      open: () => !!lkb.floats[bid]?.open,
      toggle: () => lkfSetOpen(bid, !lkb.floats[bid]?.open),
      back: () => lkfUnfloat(bid),
      live: () => {
        const el = lkfWinEl(bid);
        if (!el) return '';
        if (el.querySelector('.lkb-trk.on')) return '播放中';
        return [...el.querySelectorAll('video')].some(v => !v.paused && !v.ended) ? '播放中' : '';
      },
    });
  }
  return out;
}

// ── Floating practice window ──
// The metronome panel (#st-panel) is homed into #lick-practice-slot by
// licksSyncPracticePanelHome(); on the board page that slot is a free-floating,
// draggable window opened from the edge dock. Position/size/open state is
// a pure UI convenience → localStorage (lick_practice_win).
const LKW_KEY = 'lick_practice_win';
function lkwLoad() {
  try {
    const v = JSON.parse(localStorage.getItem(LKW_KEY));
    return { x: Number.isFinite(v?.x) ? v.x : null, y: Number.isFinite(v?.y) ? v.y : null, open: v?.open !== false,
      w: Number.isFinite(v?.w) ? v.w : null, h: Number.isFinite(v?.h) ? v.h : null, more: v?.more === true };
  } catch (_) { return { x: null, y: null, open: true, w: null, h: null, more: false }; }
}
function lkwSave(st) { try { localStorage.setItem(LKW_KEY, JSON.stringify(st)); } catch (_) {} }

// The live window state of the lick currently on screen (null when no lick page is mounted);
// the edge dock (dock.js) toggles open/closed through it so drag/resize saves never write a stale flag.
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
  slot.style.width = st.w ? Math.max(320, Math.min(window.innerWidth - 16, st.w)) + 'px' : '';
  // Height is intentionally not restored: the compact window sizes to its content (a stale saved height would keep it tall).
  slot.style.height = '';
  const w = slot.offsetWidth || 440;

  const dockR = typeof dockInset === 'function' ? dockInset('r') : 0;
  const x = st.x == null ? window.innerWidth - w - 24 - dockR : st.x;
  const y = st.y == null ? 130 : st.y;
  dockWinMove(slot, x, y);
}

function lkbInitPracticeWindow() {
  const slot = document.getElementById('lick-practice-slot');
  if (!slot) return;
  const st = lkwCur = lkwLoad();
  slot.classList.add('lkw');
  slot.insertAdjacentHTML('afterbegin',
    '<div class="lkw-h" title="拖动到任意位置"><span class="lkw-grip">⠿</span><b>Speed Trainer</b><button class="lkw-close agent-icon-btn" title="收起到工具坞">✕</button></div>');
  const head = slot.querySelector('.lkw-h');
  lkwApply(slot, st);
  // "节拍与提速设置" fold: remembered across reloads (reassigning ontoggle keeps this idempotent across lick switches).
  const more = document.getElementById('st-more');
  if (more) { more.open = st.more; more.ontoggle = () => { st.more = more.open; lkwSave(st); }; }
  // Drag the bottom-right corner (CSS resize) to size the window; remember it.
  dockWinWatchSize(slot, (w, h) => { st.w = w; st.h = h; lkwSave(st); });
  head.querySelector('.lkw-close').onclick = () => lkwSetOpen(false);
  dockWinDrag(slot, head, { onMove: (x, y) => { st.x = x; st.y = y; }, onEnd: () => lkwSave(st) });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { lkb, lkfLoad, lkbNormalizeLayout, lkbReconcile, lkbPlaceNew, lkbDefaultSize, lkbBottom, lkbCompact, lkbDock, lkbHit, lkbShiftRight };
}
