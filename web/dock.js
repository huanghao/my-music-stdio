// Edge dock — a vertical column of round buttons in the page margin, one per
// floating helper (Speed Trainer, 指板参考图, AI 助教). Replaces the old
// bottom-left "工具" menu and the bottom-right "AI 助教" button. The dock is only
// the launcher + live-status indicator: each helper keeps its own window
// (position/size persistence stays with it). Click a dot to open/close that
// window; a pulsing ring means the helper is running while its window is closed
// (metronome ticking, AI replying).
//
// Layout: the dock sits in the page's side margin. When the margin is too
// narrow (full-width page, small window) `.page` gets extra padding on the dock
// side — see `--dock-reserve` in style.css. Side + vertical position are
// UI-convenience state → localStorage `mps_dock`.

const DOCK_KEY = 'mps_dock';
const DOCK_W = 56;          // reserved width incl. gap (matches --dock-w in style.css)
const dockState = { side: 'r', top: 0.5 };

// Icons: inner SVG for a 24×24 stroke icon.
const DOCK_ICONS = {
  st: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 1.6M9.5 2.5h5"/>',
  fb: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8.5 5v14M14 5v14M3 9.7h18M3 14.3h18"/>',
  au: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6.5" rx="1.2"/><rect x="17" y="14" width="4" height="6.5" rx="1.2"/>',
  vi: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.4v5.2l4.6-2.6z"/>',
  ag: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
};

// Each item reads its helper's state through globals (guarded: a helper whose
// script isn't loaded, or which isn't available on this page, just has no dot).
const DOCK_ITEMS = [
  {
    id: 'st', title: 'Speed Trainer',
    avail: () => typeof lkwIsAvailable === 'function' && lkwIsAvailable(),
    open: () => lkwIsOpen(),
    toggle: () => lkwSetOpen(!lkwIsOpen()),
    live: () => (typeof stState !== 'undefined' && stState.running) ? `运行中 ${stState.currentBpm} BPM` : '',
  },
  {
    id: 'fb', title: '指板参考图',
    avail: () => typeof fbState !== 'undefined' && typeof fbIvOpen === 'function',
    open: () => fbState.iv.open,
    toggle: () => (fbState.iv.open ? fbIvClose() : fbIvOpen()),
    live: () => '',
  },
  {
    id: 'ag', title: 'AI 助教',
    avail: () => typeof agentState !== 'undefined' && typeof agentOpen === 'function',
    open: () => agentState.open && !(agentState.mode === 'sidebar' && agentState.sidebarCollapsed),
    toggle: () => {
      // A collapsed sidebar rail counts as "closed" for the dot: clicking expands it.
      if (agentState.open && agentState.mode === 'sidebar' && agentState.sidebarCollapsed) agentToggleSidebarCollapsed();
      else if (agentState.open) agentClose();
      else agentOpen();
    },
    live: () => (typeof agentLoading !== 'undefined' && agentLoading) ? '回复中' : '',
  },
];

function dockLoad() {
  try {
    const s = JSON.parse(localStorage.getItem(DOCK_KEY));
    if (s?.side === 'l' || s?.side === 'r') dockState.side = s.side;
    if (Number.isFinite(s?.top)) dockState.top = Math.min(0.95, Math.max(0.05, s.top));
  } catch (_) {}
}
function dockSave() {
  try { localStorage.setItem(DOCK_KEY, JSON.stringify({ side: dockState.side, top: dockState.top })); } catch (_) {}
}

// Width other floating UI should keep clear of on a given side (0 when the dock is elsewhere).
function dockInset(side) {
  return dockState.side === side ? DOCK_W : 0;
}

// Viewport rect of a dock dot (null if not rendered) — windows open next to their dot.
function dockDotRect(id) {
  const el = document.querySelector(`#dock [data-dock="${CSS.escape(id)}"]`);
  return el ? el.getBoundingClientRect() : null;
}

function dockEl() { return document.getElementById('dock'); }

function dockApplyPlacement() {
  const dock = dockEl();
  if (!dock) return;
  dock.classList.toggle('r', dockState.side === 'r');
  dock.classList.toggle('l', dockState.side === 'l');
  dock.style.setProperty('--dock-top', dockState.top);
  const root = document.documentElement;
  root.classList.toggle('dock-r', dockState.side === 'r');
  root.classList.toggle('dock-l', dockState.side === 'l');
  // Keep the dock clear of a docked AI sidebar (or its collapsed rail) on the right.
  let off = 0;
  const sidebar = typeof agentState !== 'undefined' && agentState.mode === 'sidebar' && agentState.open;
  if (sidebar && dockState.side === 'r') off = agentState.sidebarCollapsed ? 40 : agentState.sidebarWidth;
  root.style.setProperty('--dock-off-r', off + 'px');
  // Floating agent panel (float mode) keeps clear of the dock too.
  root.style.setProperty('--dock-inset-r', dockInset('r') + 'px');
}

// Extra dots (below a divider): blocks the user floated out of the Lick board
// (licks-board.js lkfDockItems). Each: {id, icon, title, open(), toggle(), live(), back()}.
function dockExtraItems() {
  try { return typeof lkfDockItems === 'function' ? lkfDockItems() : []; } catch (_) { return []; }
}

function dockHtml(items, extra) {
  const grip = '<button type="button" class="dock-grip" id="dock-grip" title="拖动换边 / 调整位置" aria-label="拖动工具坞">'
    + '<svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor"><circle cx="3" cy="2" r="1.1"/><circle cx="7" cy="2" r="1.1"/><circle cx="11" cy="2" r="1.1"/><circle cx="3" cy="7" r="1.1"/><circle cx="7" cy="7" r="1.1"/><circle cx="11" cy="7" r="1.1"/></svg></button>';
  const dot = it => `<button type="button" class="dock-dot" data-dock="${htmlEsc(it.id)}" aria-label="${htmlEsc(it.title)}">`
    + `<svg viewBox="0 0 24 24" aria-hidden="true">${DOCK_ICONS[it.icon || it.id]}</svg><span class="dock-tip"></span></button>`;
  return grip + items.map(dot).join('') + (extra.length ? '<div class="dock-sep"></div>' + extra.map(dot).join('') : '');
}

let dockShown = '', dockCur = [];  // ids currently rendered, to rebuild only when availability changes
function dockRefresh() {
  const dock = dockEl();
  if (!dock) return;
  const base = DOCK_ITEMS.filter(it => { try { return it.avail(); } catch (_) { return false; } });
  const extra = dockExtraItems();
  const items = base.concat(extra);
  dockCur = items;
  const sig = items.map(it => it.id).join(',');
  if (sig !== dockShown) { dockShown = sig; dock.innerHTML = dockHtml(base, extra); }
  let anyOpen = false;
  for (const it of items) {
    const btn = dock.querySelector(`[data-dock="${it.id}"]`);
    if (!btn) continue;
    let open = false, live = '';
    try { open = !!it.open(); live = it.live(); } catch (_) {}
    anyOpen = anyOpen || open;
    btn.classList.toggle('open', open);
    btn.classList.toggle('live', !!live && !open);
    const tip = it.title + (live ? ' · ' + live : '') + (it.back && !live ? '（右键放回）' : '');
    const el = btn.querySelector('.dock-tip');
    if (el && el.textContent !== tip) el.textContent = tip;
  }
  dock.classList.toggle('active', anyOpen);
  dockApplyPlacement();
  if (typeof lkfRefresh === 'function') lkfRefresh();
}

function dockInit() {
  dockLoad();
  const dock = dockEl();
  if (!dock) return;
  dock.addEventListener('click', e => {
    const btn = e.target.closest('[data-dock]');
    if (!btn) return;
    const it = dockCur.find(x => x.id === btn.dataset.dock);
    if (it) { it.toggle(); dockRefresh(); }
  });
  // Right-click a floated-block dot → put it back on the board.
  const ctx = document.createElement('div');
  ctx.className = 'dock-ctx hidden';
  ctx.innerHTML = '<button type="button">⇲ 放回板上</button>';
  document.body.appendChild(ctx);
  let ctxItem = null;
  dock.addEventListener('contextmenu', e => {
    const btn = e.target.closest('[data-dock]');
    const it = btn && dockCur.find(x => x.id === btn.dataset.dock);
    if (!it || !it.back) return;
    e.preventDefault();
    ctxItem = it;
    ctx.classList.remove('hidden');
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, dockState.side === 'r' ? e.clientX - w : e.clientX)) + 'px';
    ctx.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, e.clientY)) + 'px';
  });
  ctx.addEventListener('click', () => { ctx.classList.add('hidden'); if (ctxItem) ctxItem.back(); ctxItem = null; dockRefresh(); });
  document.addEventListener('pointerdown', e => { if (!ctx.contains(e.target)) ctx.classList.add('hidden'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ctx.classList.add('hidden'); });
  // Drag the grip: horizontal position picks the side, vertical sets the height.
  let dragging = false;
  dock.addEventListener('pointerdown', e => {
    if (!e.target.closest('#dock-grip')) return;
    dragging = true; dock.classList.add('moving');
    dock.setPointerCapture(e.pointerId); e.preventDefault();
  });
  dock.addEventListener('pointermove', e => {
    if (!dragging) return;
    dockState.side = e.clientX < window.innerWidth / 2 ? 'l' : 'r';
    const half = dock.offsetHeight / 2 + 8;
    dockState.top = Math.min(window.innerHeight - half, Math.max(half, e.clientY)) / window.innerHeight;
    dockApplyPlacement();
  });
  const end = () => {
    if (!dragging) return;
    dragging = false; dock.classList.remove('moving');
    dockSave();
    if (typeof fbIvApplyPos === 'function') fbIvApplyPos();
  };
  dock.addEventListener('pointerup', end);
  dock.addEventListener('pointercancel', end);
  dockRefresh();
  // Helpers change state from many places (their own buttons, auto-start, page
  // navigation); a cheap poll keeps the dots honest without hooking each one.
  setInterval(dockRefresh, 400);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { dockState, dockInset, DOCK_ITEMS };
}
