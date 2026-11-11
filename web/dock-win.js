// Shared plumbing for the floating windows that the edge dock (dock.js) opens:
// the Speed Trainer window (licks-board.js lkw*), 指板参考图 (fb-iv.js) and the
// floated Lick blocks (licks-board.js lkf*). Each window keeps its own content
// and its own saved state; this file only owns the behaviour they all share —
// clamped positioning, drag-by-header, debounced size tracking and the default
// spot next to the dock dot that opens them. (The AI 助教 panel is anchored to
// a screen corner / docks as a sidebar, so it does not use these.)

const DOCK_WIN_MARGIN = 8;

// Sets left/top (clamped to the viewport) and clears right/bottom anchoring.
// Returns the clamped {x, y}.
function dockWinMove(el, x, y) {
  const w = el.offsetWidth || 0;
  const cx = Math.max(DOCK_WIN_MARGIN, Math.min(window.innerWidth - w - DOCK_WIN_MARGIN, x));
  const cy = Math.max(DOCK_WIN_MARGIN, Math.min(window.innerHeight - 60, y));
  Object.assign(el.style, { left: cx + 'px', top: cy + 'px', right: 'auto', bottom: 'auto' });
  return { x: cx, y: cy };
}

// Default top-left for a window of the given size, beside the dock dot `dotId`
// (falls back to beside the dock itself, then to the right edge).
function dockWinBeside(dotId, w, h) {
  const onRight = typeof dockState === 'undefined' || dockState.side === 'r';
  const r = (typeof dockDotRect === 'function' && (dotId && dockDotRect(dotId))) ||
    document.getElementById('dock')?.getBoundingClientRect() || null;
  if (!r || !r.width) return { x: window.innerWidth - w - 80, y: 120 };
  return { x: onRight ? r.left - w - 14 : r.right + 14, y: Math.min(r.top - 8, window.innerHeight - h - 20) };
}

// Drag `el` by `head`. Buttons / inputs in the header stay clickable.
//   opts.onMove(x, y)  — live, after clamping
//   opts.onEnd(x, y)   — pointer released (persist here)
//   opts.onReset()     — double-click on the header (optional)
function dockWinDrag(el, head, opts = {}) {
  head.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button,input,select')) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, r = el.getBoundingClientRect();
    let last = { x: r.left, y: r.top };
    el.classList.add('dragging');
    const move = ev => {
      last = dockWinMove(el, r.left + ev.clientX - x0, r.top + ev.clientY - y0);
      opts.onMove?.(last.x, last.y);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      opts.onEnd?.(last.x, last.y);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
  if (opts.onReset) head.addEventListener('dblclick', e => { if (!e.target.closest('button,input,select')) opts.onReset(); });
}

// Reports the window's size (debounced) after the user resizes it with the CSS
// `resize` grip. The initial observation and hidden states are ignored.
function dockWinWatchSize(el, onSize, delay = 300) {
  let first = true, t = 0;
  const ro = new ResizeObserver(() => {
    if (first) { first = false; return; }
    if (!el.offsetWidth) return;
    clearTimeout(t);
    t = setTimeout(() => onSize(Math.round(el.offsetWidth), Math.round(el.offsetHeight)), delay);
  });
  ro.observe(el);
  return ro;
}

// Bring-to-front among dock windows.
let dockWinZ = 0;
function dockWinRaise(el) { el.style.zIndex = 505 + (dockWinZ = dockWinZ % 20 + 1); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { dockWinMove, dockWinBeside, dockWinDrag, dockWinWatchSize, dockWinRaise };
}
