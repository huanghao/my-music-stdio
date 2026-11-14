// Improv roulette — random lick vocabulary over a 12-bar blues in E.
//
// Independent of the Licks store: phrases come from /api/roulette/catalog (src/roulette.py).
// Each phrase is one "block" (explanation paragraph + staff/tab) of a lesson PDF; we cut the
// block out of the PDF in the browser with the vendored pdf.js, so the notation shown is
// exactly the author's. The backing track is the lesson's own 12-bar-in-E recording: a 2-bar
// count-in, then `choruses` identical 12-bar choruses, which we loop.

const IMP_PREFS_KEY = 'improv_prefs';
const IMP_SLOT_BARS = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]];
const IMP_SLOT_CHORD = ['E7', 'E7', 'A7', 'E7', '9-10', '11-12'];
const IMP_CROP_SCALE = 2.2;

const imp = {
  catalog: null, cropsByPdf: new Map(), crops: new Map(),   // crops: phrase.id -> {url, w, h}
  audio: null, running: false, raf: 0,
  base: 0,            // choruses completed in earlier loops of the audio file
  plans: new Map(),   // absolute chorus index -> [slot plan]
  lastLesson: null, lastKey: '', prefs: { rate: 1, offsetMs: 0, lessons: null, every: 2 },
};

function impPrefsLoad() {
  let saved = {};
  saved = lsJson(IMP_PREFS_KEY, {});
  if (Number.isFinite(saved.rate) && saved.rate >= 0.4 && saved.rate <= 1.5) imp.prefs.rate = saved.rate;
  if (Number.isFinite(saved.offsetMs)) imp.prefs.offsetMs = Math.max(-1000, Math.min(1000, saved.offsetMs));
  if ([1, 2, 3].includes(saved.every)) imp.prefs.every = saved.every;
if (Array.isArray(saved.lessons)) imp.prefs.lessons = saved.lessons.filter(Number.isInteger);
}
function impPrefsSave() {
  try { localStorage.setItem(IMP_PREFS_KEY, JSON.stringify(imp.prefs)); } catch (_) {}
}
function impLessons() { return [...new Set(imp.catalog.phrases.map(p => p.lesson))].sort((a, b) => a - b); }
function impEnabledLessons() { return imp.prefs.lessons || impLessons(); }

// ── PDF → phrase images ──────────────────────────────────────────────────

let impPdfjs = null;
async function impLoadPdfjs() {
  if (!impPdfjs) {
    impPdfjs = await import('/vendor/pdfjs/build/pdf.mjs');
    impPdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.mjs';
  }
  return impPdfjs;
}

// Paragraph = consecutive prose lines. Block i is the notation between paragraph i and paragraph i+1.
function impFindBlocks(lines, copyrightY) {
  // Prose = a real sentence. Bend marks in the music ("full full", "1/4") and music-font gibberish
  // ("qaa z=[qp ] e") also come out as text, so require several genuine English words.
  const words = t => t.replace(/\b(full|half)\b|\d+\/\d+/g, ' ').split(/\s+/).filter(w => /^[A-Za-z][A-Za-z'.,!-]{2,}$/.test(w));   // 3+ letters: music-font gibberish is full of 2-letter "fi"
  const strong = l => words(l.text).length >= 3 && !/^(Copyright|Blues Licks, Lesson|www\.)/.test(l.text);
  // A paragraph's last line can be short ("octave (12 frets) higher.") — attach such stragglers.
  const weak = l => words(l.text).some(w => w.length >= 4) && !/^(Copyright|Blues Licks, Lesson|www\.)/.test(l.text);
  const paras = [];
  for (const l of [...lines].sort((a, b) => a.y - b.y)) {
    const last = paras[paras.length - 1];
    if (strong(l)) { if (last && l.y - last.lastY <= 20) last.lastY = l.y; else paras.push({ firstY: l.y, lastY: l.y }); }
    else if (weak(l) && last && l.y - last.lastY <= 20) last.lastY = l.y;
  }
  return paras.map((p, i) => ({ top: p.lastY + 6, bottom: (paras[i + 1] ? paras[i + 1].firstY : copyrightY) - 14 }));
}

async function impCutPdf(url) {
  const pdfjs = await impLoadPdfjs();
  const doc = await pdfjs.getDocument({ url }).promise;
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const rows = new Map();
  for (const it of tc.items) {
    const t = it.str.trim();
    if (!t) continue;
    const y = Math.round((vp1.height - it.transform[5]) / 3) * 3;
    rows.set(y, (rows.get(y) || '') + (rows.has(y) ? ' ' : '') + t);
  }
  const lines = [...rows].map(([y, text]) => ({ y, text }));
  const copy = lines.find(l => /^Copyright/.test(l.text));
  const blocks = impFindBlocks(lines, copy ? copy.y : vp1.height - 30);
  const vp = page.getViewport({ scale: IMP_CROP_SCALE });
  const full = document.createElement('canvas');
  full.width = vp.width; full.height = vp.height;
  await page.render({ canvasContext: full.getContext('2d'), viewport: vp }).promise;
  const out = [];
  for (const b of blocks) {
    const sx = Math.round(30 * IMP_CROP_SCALE), sw = Math.round((vp1.width - 60) * IMP_CROP_SCALE);
    const sy = Math.max(0, Math.round(b.top * IMP_CROP_SCALE)), sh = Math.max(1, Math.round((b.bottom - b.top) * IMP_CROP_SCALE));
    const ctx = full.getContext('2d');
    const data = ctx.getImageData(sx, sy, sw, Math.min(sh, full.height - sy)).data;
    const rowsN = data.length / 4 / sw;
    let first = -1, last = -1;
    for (let r = 0; r < rowsN && first < 0; r++) for (let x = 0; x < sw; x += 2) if (data[(r * sw + x) * 4] < 200) { first = r; break; }
    for (let r = rowsN - 1; r >= 0 && last < 0; r--) for (let x = 0; x < sw; x += 2) if (data[(r * sw + x) * 4] < 200) { last = r; break; }
    if (first < 0) { out.push(null); continue; }
    const pad = 10, y0 = Math.max(0, first - pad), y1 = Math.min(rowsN, last + pad);
    const c = document.createElement('canvas');
    c.width = sw; c.height = y1 - y0;
    c.getContext('2d').drawImage(full, sx, sy + y0, sw, y1 - y0, 0, 0, sw, y1 - y0);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    out.push({ url: URL.createObjectURL(blob), w: c.width, h: c.height });
  }
  return out;
}

async function impLoadCrops(onProgress) {
  const pdfs = [...new Set(imp.catalog.phrases.map(p => p.pdf))];
  let done = 0;
  for (const url of pdfs) {
    try { imp.cropsByPdf.set(url, await impCutPdf(url)); } catch (e) { console.warn('improv: cannot cut', url, e); imp.cropsByPdf.set(url, []); }
    done++;
    onProgress?.(done, pdfs.length);
  }
  for (const p of imp.catalog.phrases) {
    const c = (imp.cropsByPdf.get(p.pdf) || [])[p.block];
    if (c) imp.crops.set(p.id, c);
  }
}

// ── Choosing phrases ─────────────────────────────────────────────────────

function impSlotCandidates(slot) {
  const on = new Set(impEnabledLessons());
  const pool = imp.catalog.phrases.filter(p => on.has(p.lesson) && imp.crops.has(p.id));
  const key = IMP_SLOT_CHORD[slot];
  const bars = IMP_SLOT_BARS[slot];
  const label = `第 ${bars[0]}–${bars[1]} 小节`;
  const cands = [];
  if (key === '9-10' || key === '11-12') {
    pool.filter(p => p.slot === key).forEach(p => cands.push({ parts: [{ p, label }] }));
    const [c1, c2] = key === '9-10' ? ['B7', 'A7'] : ['E7', 'B7'];
    const ones = c => pool.filter(p => p.bars === 1 && p.slot === 'chord' && p.chords.includes(c));
    const a = ones(c1), b = ones(c2);
    if (a.length && b.length) {
      for (let i = 0; i < 2; i++) {
        cands.push({ parts: [
          { p: a[Math.floor(Math.random() * a.length)], label: `第 ${bars[0]} 小节 · ${c1}` },
          { p: b[Math.floor(Math.random() * b.length)], label: `第 ${bars[1]} 小节 · ${c2}` },
        ] });
      }
    }
  } else {
    pool.filter(p => p.slot === 'chord' && p.chords.includes(key))
      .forEach(p => cands.push({ parts: [{ p, label: p.bars === 1 ? `${label} · ${key}（一小节句，弹两遍）` : `${label} · ${key}` }] }));
  }
  return cands;
}

function impPickSlot(slot) {
  let cands = impSlotCandidates(slot);
  if (!cands.length) return null;
  const fresh = cands.filter(c => c.parts[0].p.lesson !== imp.lastLesson);
  if (fresh.length) cands = fresh;
  const pick = cands[Math.floor(Math.random() * cands.length)];
  imp.lastLesson = pick.parts[pick.parts.length - 1].p.lesson;
  return pick;
}

function impPlan(k) {
  if (!imp.plans.has(k)) {
    const slots = [];
    for (let s = 0; s < 6; s++) slots.push(s % imp.prefs.every === 0 ? impPickSlot(s) : { rest: true });
    imp.plans.set(k, slots);
    for (const old of [...imp.plans.keys()]) if (old < k - 2) imp.plans.delete(old);
  }
  return imp.plans.get(k);
}

function impReroll() {
  const cur = imp.cursor;
  if (!cur) return;
  const next = cur.s + 1 < 6 ? { k: cur.k, s: cur.s + 1 } : { k: cur.k + 1, s: 0 };
  if (impPlan(next.k)[next.s]?.rest) return;
  impPlan(next.k)[next.s] = impPickSlot(next.s);
  imp.lastKey = '';
  impRenderCards();
}

// ── Clock ────────────────────────────────────────────────────────────────

function impForm() { return imp.catalog.form; }
function impBarSec() { return 4 * 60 / impForm().bpm; }
function impChorusSec() { return 12 * impBarSec(); }

// -> {k, bar(0-11), beat(0-3)} or {countIn:true, beat} before the first chorus
function impPosition(t) {
  const f = impForm();
  const rel = t - f.lead_in_sec - imp.prefs.offsetMs / 1000;
  if (rel < 0 && imp.base === 0) {
    const beatsLeft = Math.ceil(-rel / (60 / f.bpm));
    return { countIn: true, left: beatsLeft };
  }
  const r = Math.max(0, rel);
  const chorus = Math.floor(r / impChorusSec());
  const inChorus = r - chorus * impChorusSec();
  const barF = inChorus / impBarSec();
  return { k: imp.base + chorus, bar: Math.min(11, Math.floor(barF)), beat: Math.min(3, Math.floor((barF % 1) * 4)) };
}

function impTick() {
  if (!imp.running) return;
  const f = impForm(), a = imp.audio;
  const endT = f.lead_in_sec + f.choruses * impChorusSec();
  if (a.currentTime >= endT - 0.04) {      // loop the choruses seamlessly-enough; skip the count-in next time
    imp.base += f.choruses;
    a.currentTime = f.lead_in_sec + imp.prefs.offsetMs / 1000;
  }
  const pos = impPosition(a.currentTime);
  const key = pos.countIn ? `c${pos.left}` : `${pos.k}:${pos.bar}`;
  if (key !== imp.lastKey) {
    imp.lastKey = key;
    imp.cursor = pos.countIn ? null : { k: pos.k, s: Math.floor(pos.bar / 2) };
    impRenderStrip(pos);
    impRenderCards(pos);
  }
  if (!pos.countIn) impRenderBeat(pos.beat);
  imp.raf = requestAnimationFrame(impTick);
}

// ── Rendering ────────────────────────────────────────────────────────────

function impPartHtml(part, big) {
  const c = imp.crops.get(part.p.id);
  return `<figure class="m-0 mb-3">
    <figcaption class="text-sm mb-1"><b>Lesson ${part.p.lesson} · ${htmlEsc(part.p.title)}</b>
      <span class="text-fg-muted"> · ${htmlEsc(part.label)}${part.p.tag ? ` · ${htmlEsc(part.p.tag)}` : ''}</span></figcaption>
    <img class="block w-full h-auto bg-white rounded-md border border-solid border-line" src="${c.url}" alt="" draggable="false">
    ${big && part.p.hint ? `<div class="text-xs text-fg-muted mt-1">${htmlEsc(part.p.hint)}</div>` : ''}
  </figure>`;
}

function impSlotHtml(plan, big) {
  if (plan && plan.rest) return `<div class="py-6 text-center"><div class="text-3xl font-bold">你来</div><div class="text-fg-muted text-sm mt-1">${big ? '用上一句的素材自己回应：重复、改一两个音、换个位置' : '留白，自己接'}</div></div>`;
  return plan ? plan.parts.map(p => impPartHtml(p, big)).join('') : '<p class="empty-state">没有可用的乐句（检查题库勾选）</p>';
}

function impRenderCards(pos) {
  pos = pos || imp.lastPos;
  imp.lastPos = pos;
  const nowEl = document.getElementById('imp-now'), nextEl = document.getElementById('imp-next');
  if (!nowEl || !nextEl) return;
  if (!imp.running) {
    nowEl.innerHTML = '';
    nextEl.innerHTML = '';
    return;
  }
  if (!pos || pos.countIn) {
    const k = imp.base;
    nowEl.innerHTML = `<div class="text-4xl font-bold">预备 ${pos ? pos.left : ''}</div><div class="text-fg-muted">2 小节预备拍后开始；先看右边第一句</div>`;
    nextEl.innerHTML = `<h3 class="text-sm text-fg-dim mt-0 mb-2">第一句</h3>${impSlotHtml(impPlan(k)[0], false)}`;
    return;
  }
  const { k, bar } = pos, s = Math.floor(bar / 2);
  const here = impPlan(k)[s];
  const after = s + 1 < 6 ? { k, s: s + 1 } : { k: k + 1, s: 0 };
  nowEl.innerHTML = `<h3 class="text-sm text-fg-dim mt-0 mb-2">现在 · 第 ${IMP_SLOT_BARS[s][0]}–${IMP_SLOT_BARS[s][1]} 小节</h3>${impSlotHtml(here, true)}`;
  nextEl.innerHTML = `<h3 class="text-sm text-fg-dim mt-0 mb-2">下一句 · 第 ${IMP_SLOT_BARS[after.s][0]}–${IMP_SLOT_BARS[after.s][1]} 小节</h3>${impSlotHtml(impPlan(after.k)[after.s], false)}`;
}

function impRenderStrip(pos) {
  const el = document.getElementById('imp-strip');
  if (!el) return;
  const chords = impForm().chords;
  el.innerHTML = chords.map((c, i) => {
    const on = pos && !pos.countIn && pos.bar === i;
    return `<div class="flex-1 min-w-0 text-center py-1.5 rounded-md border border-solid ${on ? 'bg-primary text-fg-inverse border-primary font-bold' : 'bg-card border-line text-fg-dim'}">
      <div class="text-[11px] opacity-70">${i + 1}</div><div class="text-sm">${htmlEsc(c)}</div></div>`;
  }).join('');
}

function impRenderBeat(beat) {
  const el = document.getElementById('imp-beat');
  if (!el) return;
  el.innerHTML = [0, 1, 2, 3].map(i => `<span class="inline-block size-3 rounded-full ${i === beat ? 'bg-primary' : 'bg-faint'}"></span>`).join('');
}

function impControlsHtml() {
  const on = new Set(impEnabledLessons());
  return `
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <button class="btn btn-primary" id="imp-go" onclick="impToggle()">▶ 开始</button>
      <label class="text-sm">速度 <select id="imp-rate" onchange="impSetRate(this.value)">
        ${[0.5, 0.6, 0.7, 0.8, 0.9, 1].map(r => `<option value="${r}"${r === imp.prefs.rate ? ' selected' : ''}>${Math.round(r * impForm().bpm)} BPM</option>`).join('')}</select></label>
      <label class="text-sm" title="听起来换和弦的时机偏早/偏晚时微调">对齐
        <button class="btn btn-ghost btn-sm" onclick="impNudge(-20)">−</button>
        <span id="imp-offset" class="tabular-nums">${imp.prefs.offsetMs} ms</span>
        <button class="btn btn-ghost btn-sm" onclick="impNudge(20)">＋</button></label>
      <label class="text-sm" title="出一句之后，留几个 2 小节给你自己接">密度 <select id="imp-every" onchange="impSetEvery(this.value)">
        ${[[1, '每 2 小节一句（密）'], [2, '一句 + 2 小节留白'], [3, '一句 + 4 小节留白']].map(([v, t]) => `<option value="${v}"${v === imp.prefs.every ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <button class="btn btn-ghost btn-sm" onclick="impReroll()" title="把“下一句”换成另一句">↻ 换下一句</button>
      <span class="flex-1"></span>
      <span id="imp-beat" class="inline-flex gap-1.5 items-center"></span>
    </div>
    <details class="mb-3 text-sm" id="imp-pool"><summary class="cursor-pointer text-fg-dim select-none">题库：${on.size} / ${impLessons().length} 课参与随机</summary>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2">${impLessons().map(n => {
        const t = imp.catalog.phrases.find(p => p.lesson === n).title;
        return `<label class="inline-flex items-center gap-1.5"><input type="checkbox" ${on.has(n) ? 'checked' : ''} onchange="impToggleLesson(${n}, this.checked)"> ${n}. ${htmlEsc(t)}</label>`;
      }).join('')}</div></details>`;
}

// ── Actions ──────────────────────────────────────────────────────────────

function impToggleLesson(n, checked) {
  const set = new Set(impEnabledLessons());
  checked ? set.add(n) : set.delete(n);
  imp.prefs.lessons = [...set];
  impPrefsSave();
  imp.plans.clear();
  const sm = document.querySelector('#imp-pool summary');
  if (sm) sm.textContent = `题库：${set.size} / ${impLessons().length} 课参与随机`;
}
function impSetEvery(v) {
  imp.prefs.every = Number(v);
  imp.plans.clear();
  imp.lastKey = '';
  impPrefsSave();
}
function impSetRate(v) {
  imp.prefs.rate = Number(v);
  if (imp.audio) imp.audio.playbackRate = imp.prefs.rate;
  impPrefsSave();
}
function impNudge(ms) {
  imp.prefs.offsetMs += ms;
  document.getElementById('imp-offset').textContent = `${imp.prefs.offsetMs} ms`;
  impPrefsSave();
}

function impStart() {
  const f = impForm();
  if (!imp.audio) { imp.audio = new Audio(f.audio); imp.audio.preload = 'auto'; }
  imp.audio.playbackRate = imp.prefs.rate;
  imp.audio.currentTime = 0;
  imp.base = 0; imp.plans.clear(); imp.lastLesson = null; imp.lastKey = ''; imp.cursor = null;
  imp.running = true;
  imp.audio.play().catch(e => { setStatus('播放失败：' + e.message); impStop(); });
  document.getElementById('imp-go').textContent = '■ 停止';
  imp.raf = requestAnimationFrame(impTick);
}
function impStop() {
  imp.running = false;
  cancelAnimationFrame(imp.raf);
  imp.audio?.pause();
  const b = document.getElementById('imp-go');
  if (b) b.textContent = '▶ 开始';
  impRenderStrip(null);
  impRenderCards(null);
  impRenderBeat(-1);
}
const impToggle = guarded(() => (imp.running ? impStop() : impStart()));

async function initImprovPage() {
  const root = document.getElementById('imp-root');
  if (!root) return;
  if (imp.catalog) return;   // already built; keep running state across revisits
  root.innerHTML = '<p class="text-fg-muted">加载题库…</p>';
  try {
    imp.catalog = await api('/api/roulette/catalog');
    impPrefsLoad();
    root.innerHTML = `<div id="imp-controls">${impControlsHtml()}</div>
      <div id="imp-loading" class="text-xs text-fg-muted mb-2"></div>
      <div id="imp-strip" class="flex gap-1 mb-4"></div>
      <div class="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
        <section id="imp-now"></section><aside id="imp-next"></aside></div>`;
    impRenderStrip(null); impRenderCards(null); impRenderBeat(-1);
    await impLoadCrops((d, n) => {
      const el = document.getElementById('imp-loading');
      if (el) el.textContent = d < n ? `正在从 PDF 切出谱例 ${d} / ${n}…` : '';
    });
  } catch (e) {
    root.innerHTML = `<p class="text-danger">加载失败：${htmlEsc(e.message)}</p>`;
    imp.catalog = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { impFindBlocks, impPosition, impPlan, impSlotCandidates, imp };
}
