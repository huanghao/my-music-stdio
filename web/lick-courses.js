// Course organization and practice settings. All session history remains on individual licks.
// A lick is a song, an exercise or a band-class piece; stored as the single entry of `tags` so the server model stays as is.
const LICK_TYPES = ['歌曲', '练习', '乐队课'];
const LICK_STATUS_LABELS = { active: '在练', waiting: '待练', maintenance: '维护', archived: '归档' };
let lickCatalog = [];
let lickPlanSave = Promise.resolve();

const LICK_COURSE_UI_KEY = 'lick_course_ui';

// This is device-local convenience state; training settings remain on the server.
function licksCourseUiLoad(storage) {
  const empty = { query: '', type: '', panels: {}, videos: {} };
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    const value = JSON.parse(store?.getItem(LICK_COURSE_UI_KEY) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
    const panels = value.panels && typeof value.panels === 'object' && !Array.isArray(value.panels)
      ? Object.fromEntries(Object.entries(value.panels).filter(([, v]) => typeof v === 'boolean')) : {};
    const videos = {};
    if (value.videos && typeof value.videos === 'object' && !Array.isArray(value.videos)) {
      for (const [key, v] of Object.entries(value.videos)) {
        if (v && Number.isFinite(v.time) && v.time >= 0 && Number.isFinite(v.rate) && v.rate >= 0.25 && v.rate <= 4) videos[key] = { time: v.time, rate: v.rate };
      }
    }
    // Older builds saved `tags` (list) / `tag` (string) and a status filter; map whichever type they held.
    const old = [...(Array.isArray(value.tags) ? value.tags : []), value.tag].find(t => LICK_TYPES.includes(t));
    return { query: typeof value.query === 'string' ? value.query.slice(0, 300) : '',
      type: LICK_TYPES.includes(value.type) ? value.type : (old || ''), panels, videos };
  } catch (_) { return empty; }
}

let lickCourseUi = licksCourseUiLoad();
function licksCourseUiSave() {
  try { localStorage.setItem(LICK_COURSE_UI_KEY, JSON.stringify(lickCourseUi)); } catch (_) { /* optional UI state */ }
}

function licksDetailsAttrs(key, filterOpen = false) {
  return `data-ui-key="${htmlEsc(key)}" data-filter-open="${filterOpen ? '1' : '0'}" ontoggle="licksRememberDetails(this)" ${filterOpen || lickCourseUi.panels[key] ? 'open' : ''}`;
}

function licksRememberDetails(el) {
  // Filter results expand temporarily; do not overwrite the user's normal view.
  if (el.dataset.filterOpen === '1' || !el.dataset.uiKey) return;
  if (lickCourseUi.panels[el.dataset.uiKey] === el.open) return;
  lickCourseUi.panels[el.dataset.uiKey] = el.open;
  licksCourseUiSave();
}

function licksStalenessClass(lastDate) {
  const accent = licksStalenessAccent(lastDate);
  // Only stale licks carry a mark; fresh and in-between are the quiet default.
  return accent === 'var(--warn)' ? 'border-l-warn!' : 'border-l-transparent!';
}

function licksSyncPlanVisibility(active) {
  document.getElementById('lick-plan-cycles')?.classList.toggle('hidden', !active);
  document.getElementById('st-legacy-bars')?.classList.toggle('hidden', active);
}

let lickCourseNavigating = false;
async function licksOpenCourseLick(id) {
  if (lickCourseNavigating) return;
  lickCourseNavigating = true;
  try { return await navOpenLick(id); }
  finally { lickCourseNavigating = false; }
}
if (typeof guarded === 'function') licksOpenCourseLick = guarded(licksOpenCourseLick);

function licksRememberDemo(video) {
  if (!video.dataset.demoKey || !Number.isFinite(video.currentTime)) return;
  lickCourseUi.videos[video.dataset.demoKey] = { time: video.currentTime, rate: video.playbackRate };
  licksCourseUiSave();
}

function licksRestoreDemo(video) {
  const saved = lickCourseUi.videos[video.dataset.demoKey];
  if (!saved) return;
  if (Number.isFinite(video.duration)) video.currentTime = Math.min(saved.time, Math.max(0, video.duration - 0.1));
  video.playbackRate = saved.rate;
}

function licksCourseOrder(items) {
  return [...items].sort((a, b) => (a.course_order ?? 99999) - (b.course_order ?? 99999)
    || (a.title || '').localeCompare(b.title || ''));
}

// `tags` may be one tag or a list; a lick must carry every selected tag (AND), so adding a chip narrows the list.
function licksFilterItems(items, query = '', status = '', tags = []) {
  const q = query.trim().toLocaleLowerCase();
  const need = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  return items.filter(l => (!status || (l.status || 'active') === status)
    && need.every(t => (l.tags || []).includes(t))
    && (!q || [l.title, l.collection, ...(l.tags || [])].join(' ').toLocaleLowerCase().includes(q)));
}

function licksGroupCourses(items) {
  const groups = new Map();
  for (const l of items) {
    if (!l.collection) continue;
    if (!groups.has(l.collection)) groups.set(l.collection, []);
    groups.get(l.collection).push(l);
  }
  return [...groups].map(([name, lessons]) => ({ name, lessons: licksCourseOrder(lessons) }));
}


// The most recently practiced lick overall — the one you just came back from. It gets a soft
// highlight, and its course is scrolled so the row is visible (see licksRevealJust).
let licksJustId = null;
function licksComputeJust(items) {
  let best = null;
  for (const l of items) if (l.last_date && (!best || l.last_date > best.last_date)) best = l;
  licksJustId = best ? best.id : null;
}

function licksRowHtml(l) {
  const just = l.id === licksJustId;
  const bpm = l.last_practiced_bpm ?? l.last_bpm;
  const progress = bpm != null ? `${bpm}${l.target_bpm ? ` / ${l.target_bpm}` : ''} BPM` : '尚未开始';
  // ids may be non-Latin slugs. Encode before placing them in an event handler.
  const id = encodeURIComponent(l.id).replace(/'/g, '%27');
  return `<button type="button" class="lick-card lick-course-row ${licksStalenessClass(l.last_date)} w-full text-left text-fg ${just ? 'bg-primary-bg! lick-just' : 'bg-transparent!'} font-normal max-sm:items-start! max-sm:gap-2!" data-lick-id="${htmlEsc(l.id)}"
      onclick="licksOpenCourseLick(decodeURIComponent('${id}'))" >
    <span class="lick-row-name flex items-center gap-3 min-w-0">${l.course_order ? `<span class="lick-order text-sm text-fg-muted tabular-nums">${String(l.course_order).padStart(2, '0')}</span>` : ''}
      <span>${htmlEsc(l.title)}</span></span>
    <span class="lick-card-right max-sm:flex-wrap max-sm:justify-end max-sm:max-w-[45%]"><span class="lick-card-bpm">${progress}</span><span class="lick-card-last max-sm:text-xs! ${just ? 'text-primary!' : ''}">${l.last_date ? timeAgo(l.last_date) : '—'}</span></span>
  </button>`;
}

async function licksLoadCatalog() {
  // Fetch on every list visit; cold deep links also need the catalog for previous/next.
  const items = await api('/api/licks');
  lickCatalog = items;
  items.forEach(l => { licksState.licksById[l.id] = { ...licksState.licksById[l.id], ...l }; });
  return items;
}

async function licksLoadCourseList() {
  const el = document.getElementById('licks-list');
  try {
    await licksLoadCatalog();
    document.getElementById('licks-search').value = lickCourseUi.query;
    licksFilterList();
    renderLickHeatmap();
  } catch (e) { el.textContent = '加载失败：' + e.message; }
}

function licksSetListType(type) {
  lickCourseUi.type = lickCourseUi.type === type ? '' : type;   // clicking the active tab goes back to "全部"
  licksFilterList();
}

// "全部 / 歌曲 / 练习" — same segmented pills as the Progressions mode switch.
function licksRenderTypeTabs() {
  const el = document.getElementById('licks-type-tabs');
  if (!el) return;
  const count = t => lickCatalog.filter(l => (l.tags || []).includes(t)).length;
  const tab = (label, value, n) => `<button type="button" class="pl-lookup-tab${lickCourseUi.type === value ? ' active' : ''}" aria-pressed="${lickCourseUi.type === value}"
    onclick="licksSetListType('${value}')">${label} <span class="text-fg-faint">${n}</span></button>`;
  el.innerHTML = tab('全部', '', lickCatalog.length) + LICK_TYPES.map(t => tab(t, t, count(t))).join('');
}

function licksFilterList() {
  const el = document.getElementById('licks-list');
  const query = document.getElementById('licks-search').value;
  const status = '';   // the manual status label is no longer a filter; recency drives "继续练习"
  const tag = !!lickCourseUi.type;
  Object.assign(lickCourseUi, { query });
  licksCourseUiSave();
  licksRenderTypeTabs();
  licksComputeJust(lickCatalog);
  const items = licksFilterItems(lickCatalog, query, status, lickCourseUi.type);
  const groups = licksGroupCourses(items);
  const summary = document.getElementById('licks-summary');
  if (summary) summary.textContent = `${lickCatalog.length} 条练习 · ${licksGroupCourses(lickCatalog).length} 个课程集`;
  let main = '';
  if (groups.length) main += `<section class="lick-list-section my-6"><h3 class="text-base text-fg-dim mb-3 mt-0">课程集</h3>${groups.map(g => {
    const all = lickCatalog.filter(l => l.collection === g.name);
    return `<details class="lick-collection group border border-solid border-line rounded-lg my-3 bg-card" data-collection="${htmlEsc(g.name)}" ${licksDetailsAttrs('collection:' + g.name, !!(query || status || tag))}>
      <summary class="cursor-pointer flex gap-3 items-center p-4 list-none"><span aria-hidden="true" class="text-xl text-fg-muted transition-transform group-open:rotate-90">›</span><span class="lick-collection-name flex-1 text-lg font-semibold">${htmlEsc(g.name)}</span><span class="text-fg-muted text-sm font-normal shrink-0">${all.length} 课</span>
      </summary>
      <div class="lick-collection-lessons relative px-1 pb-2 max-h-[min(60vh,420px)] overflow-y-auto">${g.lessons.map(licksRowHtml).join('')}</div></details>`;
  }).join('')}</section>`;
  const single = licksSortByLast(items.filter(l => !l.collection));
  let side = '';
  if (single.length) side += `<section class="lick-list-section my-6"><h3 class="text-base text-fg-dim mb-3 mt-0">独立 Licks</h3><div class="border border-solid border-line rounded-lg bg-card overflow-hidden">${single.map(licksRowHtml).join('')}</div></section>`;
  if (!items.length) main += '<p class="empty-state">没有匹配的练习。可以清除筛选，或新建 Lick。</p>';
  // Wide screens: courses on the left; standalone licks + heatmap pinned on the right (see .lick-list-cols).
  el.innerHTML = main;
  document.getElementById('licks-side').innerHTML = side;
  licksRevealJust();
}

// Lessons scroll inside a capped box, so make sure the just-practiced row is inside the viewport of its
// course, even when it is the last lesson. Re-run when a course is opened (a closed <details> has no layout).
function licksScrollToJust(details) {
  const box = details.querySelector('.lick-collection-lessons');
  const row = box?.querySelector('.lick-just');
  if (!box || !row || !details.open) return;
  box.scrollTop = Math.max(0, row.offsetTop - (box.clientHeight - row.offsetHeight) / 2);
}
function licksRevealJust() {
  document.querySelectorAll('#licks-list details.lick-collection').forEach(d => {
    d.addEventListener('toggle', () => licksScrollToJust(d));
    licksScrollToJust(d);
  });
}

function licksDefaultPlan(lick = {}) {
  return { start_bpm: 60, step_bpm: 5, beats_per_bar: 4, subdivision: 1,
    loop_bars: 4, rounds_per_step: 2, auto_advance: false, bounce: false, ...(lick.practice_plan || {}) };
}

function licksPracticeSettings(lick, bpm) {
  const p = licksDefaultPlan(lick);
  return { startBpm: p.start_bpm, currentBpm: bpm,
    targetBpm: Math.max(p.start_bpm, bpm, lick.target_bpm ?? Math.max(120, p.start_bpm)), stepBpm: p.step_bpm,
    beatsPerBar: p.beats_per_bar, subdivision: p.subdivision,
    autoAdvance: p.auto_advance, autoAdvanceBars: p.loop_bars * p.rounds_per_step, bounceMode: p.bounce };
}

function licksApplyPracticePlan(lick, bpm) {
  Object.assign(stState, licksPracticeSettings(lick, bpm));
  const p = licksDefaultPlan(lick);
  document.getElementById('lick-loop-bars').value = p.loop_bars;
  document.getElementById('lick-rounds-per-step').value = p.rounds_per_step;
  licksSyncPlanVisibility(true);
  stRenderBeatRow();
}

function licksPlanCyclesChanged() {
  const loop = Math.max(1, Math.min(128, +document.getElementById('lick-loop-bars').value || 4));
  const rounds = Math.max(1, Math.min(32, +document.getElementById('lick-rounds-per-step').value || 2));
  document.getElementById('lick-loop-bars').value = loop;
  document.getElementById('lick-rounds-per-step').value = rounds;
  document.getElementById('st-auto-advance-bars').value = loop * rounds;
  stOnOptionsChanged();
}

function licksNotifyPlanChange() {
  const a = licksState.activeLick;
  if (!a) return;
  const p = { start_bpm: stState.startBpm, step_bpm: stState.stepBpm,
    beats_per_bar: stState.beatsPerBar, subdivision: stState.subdivision,
    loop_bars: +document.getElementById('lick-loop-bars').value || 4,
    rounds_per_step: +document.getElementById('lick-rounds-per-step').value || 2,
    auto_advance: stState.autoAdvance, bounce: stState.bounceMode };
  const target_bpm = stState.targetBpm;
  const update = { practice_plan: p, target_bpm };
  // Update cache immediately; serialize requests so rapid changes cannot save out of order.
  licksState.licksById[a.id] = { ...licksState.licksById[a.id], ...update };
  if (licksState.currentLick?.id === a.id) Object.assign(licksState.currentLick, update);
  const target = document.getElementById('lick-detail-target');
  if (target) {
    const cur = target.textContent.match(/^(\d+) → /);
    target.textContent = `${cur ? cur[1] + ' → ' : ''}目标 ${target_bpm} BPM`;
  }
  lickPlanSave = lickPlanSave.catch(() => {}).then(() => api(`/api/licks/${encodeURIComponent(a.id)}/practice-plan`, 'PUT', update));
  lickPlanSave.catch(e => setStatus('训练配置保存失败：' + e.message));
}

function licksSafeResourceUrl(url) { return /^(\/api\/|https?:\/\/)/.test(url || '') ? htmlEsc(url) : ''; }

function licksScoreHtml(lick) {
  const images = (lick.score_images || []).filter(u => licksSafeResourceUrl(u));
  if (!images.length) return '';
  return `<section class="lick-core-score bg-subtle border border-solid border-line rounded-lg p-2 sm:p-4 my-4 overflow-auto" aria-label="核心练习谱">${images.map((u, i) => `<img class="block w-full h-auto min-w-[650px] sm:min-w-0 my-0 [&+img]:mt-5" src="${licksSafeResourceUrl(u)}" alt="核心练习谱，第 ${i + 1} 行">`).join('')}</section>`;
}

function licksReferenceHtml(lick) {
  const source = licksSafeResourceUrl(lick.source_url), pdf = licksSafeResourceUrl(lick.pdf_url), demo = licksSafeResourceUrl(lick.demo_url);
  if (!source && !pdf && !demo) return '';
  return `<details ${licksDetailsAttrs('reference:' + lick.id)} class="lick-reference my-6 p-3 border border-solid border-line rounded-lg text-base"><summary class="cursor-pointer text-fg-dim">示范与参考资料${lick.reference_bpm_min ? ` · 视频 ${lick.reference_bpm_min}–${lick.reference_bpm_max} BPM` : ''}</summary>
    <div class="lick-reference-links flex flex-wrap items-center gap-4 my-4">${source ? `<a class="text-primary" href="${source}" target="_blank" rel="noopener">在 YouTube 打开原视频 ↗</a>` : ''}
    ${pdf ? `<a class="text-primary" href="${pdf}" target="_blank" rel="noopener">打开 / 下载 PDF ↗</a><button class="btn btn-ghost btn-sm" onclick="licksToggleReferencePdf()">批注谱子</button>` : ''}</div>
    ${demo ? `<video data-demo-key="${htmlEsc(lick.demo_url)}" onloadedmetadata="licksRestoreDemo(this)" onseeked="licksRememberDemo(this)" onratechange="licksRememberDemo(this)" onpause="licksRememberDemo(this)" controls preload="none" src="${demo}" class="lick-demo-video block w-full max-h-[65vh] bg-screen-dark rounded-md"></video>` : ''}
    ${pdf ? '<div id="lick-reference-pdf" class="hidden"></div>' : ''}</details>`;
}

function licksEnsureReferencePdf() {
  const el = document.getElementById('lick-reference-pdf');
  if (!el || el.innerHTML) return;
  const href = licksState.currentLick.pdf_url;
  const src = licksPdfViewerSrc(href, licksPdfFrag(1));
  const body = licksPdfOpenMap()[href] === false ? licksPdfThumbHtml(src, 1) : licksPdfExpandedHtml(src, 1, null);
  el.innerHTML = `<div class="lick-pdf-embed w-full! max-w-full!" data-href="${htmlEsc(href)}" data-src="${htmlEsc(src)}" data-page="1">${body}</div>`;
}

function licksToggleReferencePdf() {
  const el = document.getElementById('lick-reference-pdf');
  if (!el) return;
  el.classList.toggle('hidden');
  lickCourseUi.panels['pdf:' + licksState.currentLick.id] = !el.classList.contains('hidden');
  licksCourseUiSave();
  if (!el.classList.contains('hidden')) licksEnsureReferencePdf();
}

function licksRestoreCourseDetailUi(lick) {
  const el = document.getElementById('lick-reference-pdf');
  if (!el || !lickCourseUi.panels['pdf:' + lick.id]) return;
  el.classList.remove('hidden');
  licksEnsureReferencePdf();
}

function licksCourseNavHtml(lick) {
  if (!lick.collection) return '';
  const items = licksCourseOrder(lickCatalog.filter(l => l.collection === lick.collection));
  const at = items.findIndex(l => l.id === lick.id);
  const button = (l, label, title) => l
    ? `<button class="bg-transparent border-0 cursor-pointer px-1.5 py-0 text-fg-dim hover:text-fg text-lg leading-none" title="${title}" aria-label="${title}" onclick="licksOpenCourseLick(decodeURIComponent('${encodeURIComponent(l.id).replace(/'/g, '%27')}'))">${label}</button>`
    : `<span class="px-1.5 text-fg-dim opacity-30 text-lg leading-none">${label}</span>`;
  return `<nav class="lick-course-nav flex items-center gap-0.5 text-fg-dim text-sm" aria-label="课程导航">${button(items[at - 1], '‹', '上一课')}<span class="relative" id="lick-course-menu"><button type="button" class="bg-transparent border-0 cursor-pointer px-1.5 py-0.5 rounded-md text-fg-dim hover:bg-subtle hover:text-fg whitespace-nowrap" title="选择课程" aria-haspopup="listbox" onclick="licksToggleCourseMenu()"><span class="max-sm:hidden">${htmlEsc(lick.collection)} · </span>${at + 1} / ${items.length} ▾</button>
    <div class="hidden absolute right-0 top-full mt-1 z-30 w-72 max-h-[60vh] overflow-y-auto p-1 rounded-lg border border-solid border-line bg-card shadow-md" id="lick-course-pop" role="listbox">${items.map((l, i) =>
      `<button type="button" role="option" aria-selected="${i === at}" class="btn btn-ghost btn-sm w-full justify-start text-left whitespace-normal! ${i === at ? 'bg-primary-bg! font-semibold' : ''}" data-cur="${i === at ? 1 : 0}" onclick="licksOpenCourseLick(decodeURIComponent('${encodeURIComponent(l.id).replace(/'/g, '%27')}'))">${htmlEsc(licksDisplayTitle(l))}</button>`).join('')}</div></span>${button(items[at + 1], '›', '下一课')}</nav>`;
}

function licksToggleCourseMenu(force) {
  const pop = document.getElementById('lick-course-pop');
  if (!pop) return;
  const open = force ?? pop.classList.contains('hidden');
  pop.classList.toggle('hidden', !open);
  if (open) pop.querySelector('[data-cur="1"]')?.scrollIntoView({ block: 'center' });
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    const m = document.getElementById('lick-course-menu');
    if (m && !m.contains(e.target)) licksToggleCourseMenu(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') licksToggleCourseMenu(false); });
}

// Type switch under the title: 歌曲 / 练习 (the only tags the UI manages).
function licksTypeSwitchHtml(lick) {
  const cur = (lick.tags || []).find(t => LICK_TYPES.includes(t)) || '';
  return `<div class="pl-lookup-tabs m-0!" id="lick-type-switch" role="group" aria-label="类型">${LICK_TYPES.map(t =>
    `<button type="button" class="pl-lookup-tab${cur === t ? ' active' : ''}" aria-pressed="${cur === t}" onclick="licksSetType('${t}')">${t}</button>`).join('')}</div>`;
}

async function licksSetType(type) {
  const l = licksState.currentLick;
  if (!l) return;
  try {
    await lickPlanSave.catch(() => {});
    await licksFlushBpmSave();
    const saved = await api(`/api/licks/${encodeURIComponent(l.id)}`, 'PUT', { tags: [type] });
    licksState.licksById[l.id] = saved;
    if (licksState.currentLick?.id === l.id) licksState.currentLick = saved;
    lickCatalog = lickCatalog.map(x => x.id === l.id ? { ...x, tags: saved.tags } : x);
    const box = document.getElementById('lick-type-switch');
    if (box) box.outerHTML = licksTypeSwitchHtml(saved);
  } catch (e) { setStatus('类型保存失败：' + e.message); }
}

function licksRenderCourseEditor(lick) {
  const p = licksDefaultPlan(lick);
  const input = (key, label, value, type = 'text', attrs = '') => `<label class="flex flex-col gap-1.5 min-w-0">${label}<input class="w-full! box-border" id="lick-field-${key}" type="${type}" value="${htmlEsc(String(value ?? ''))}" ${attrs}></label>`;
  document.getElementById('lick-course-editor').innerHTML = `<details ${licksDetailsAttrs('editor:course')} class="lick-editor-course p-4 border border-solid border-line rounded-lg mb-4 text-base"><summary class="cursor-pointer text-fg-dim">课程归属与训练配置</summary><div class="lick-fields-grid grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4 my-4">
    ${input('collection', '课程集（留空为独立练习）', lick.collection, 'text', 'list="lick-collections"')}
    <datalist id="lick-collections">${[...new Set(lickCatalog.map(l => l.collection).filter(Boolean))].map(c => `<option value="${htmlEsc(c)}">`).join('')}</datalist>
    ${input('course_order', '课程序号', lick.course_order, 'number', 'min="1" max="9999"')}
    ${input('start_bpm', '起始 BPM', p.start_bpm, 'number', 'min="20" max="300"')}
    ${input('step_bpm', '每次增加 BPM', p.step_bpm, 'number', 'min="1" max="100"')}
    ${input('loop_bars', '一轮小节数', p.loop_bars, 'number', 'min="1" max="128"')}
    ${input('rounds_per_step', '每档练几轮', p.rounds_per_step, 'number', 'min="1" max="32"')}
    </div><p class="lick-field-help text-fg-muted text-sm">拍号、细分与自动提速在练习页设置，会随本课保存。视频速度范围仅供参考，个人目标在上方单独设置。</p>
    <details ${licksDetailsAttrs('editor:resources')}><summary class="cursor-pointer text-fg-dim">谱面与示范资源</summary><div class="lick-fields-grid grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4 my-4">
    ${input('source_url', '来源网址', lick.source_url)}${input('demo_url', '示范视频材料地址', lick.demo_url)}${input('pdf_url', 'PDF 材料地址', lick.pdf_url)}
    ${input('reference_bpm_min', '视频最低 BPM', lick.reference_bpm_min, 'number', 'min="20" max="300"')}
    ${input('reference_bpm_max', '视频最高 BPM', lick.reference_bpm_max, 'number', 'min="20" max="300"')}
    </div><label>谱条图片地址（每行一个）<textarea class="w-full! box-border" id="lick-field-score_images" rows="3">${htmlEsc((lick.score_images || []).join('\n'))}</textarea></label></details></details>`;
}

function licksReadCourseEditor(lick) {
  const value = key => document.getElementById('lick-field-' + key).value.trim();
  const number = (key, min, max, nullable = false) => {
    if (nullable && !value(key)) return null;
    const v = Number(value(key));
    if (!Number.isFinite(v) || v < min || v > max || (!nullable && !Number.isInteger(v))) throw new Error('请检查课程和训练配置中的数值');
    return v;
  };
  const plan = { ...licksDefaultPlan(lick), start_bpm: number('start_bpm', 20, 300), step_bpm: number('step_bpm', 1, 100),
    loop_bars: number('loop_bars', 1, 128), rounds_per_step: number('rounds_per_step', 1, 32) };
  return { collection: value('collection'), course_order: number('course_order', 1, 9999, true),
    practice_plan: plan,
    score_images: value('score_images').split('\n').map(s => s.trim()).filter(Boolean),
    source_url: value('source_url'), demo_url: value('demo_url'), pdf_url: value('pdf_url'),
    reference_bpm_min: number('reference_bpm_min', 20, 300, true), reference_bpm_max: number('reference_bpm_max', 20, 300, true) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  licksCourseOrder, licksFilterItems, licksGroupCourses, licksPracticeSettings, licksDefaultPlan,
  licksCourseUiLoad, licksStalenessClass, licksOpenCourseLick,
};
