// ── Fretboard trainer — Interval Shapes ──
// Split out of web/fretboard.js (pure code move, no logic changes).

// ── Interval Shapes (method-3 reference): pick a root note anywhere on the
// neck (string select + fret input, or just click the board), tick which
// degrees you want to see (3/5/7 etc.), and get every occurrence of the
// root + those degrees within a few frets either side —
// pure fretboard geometry, no key/scale involved. This is the "从根音出发,
// 记37音相对根音的指板形状" practice path from the take-the-a-train chat
// (see docs/voice-leading-guide-tone-lines.md).
const FB_IV_DEGREES = [
  { offset: 1,  label: 'b9' }, { offset: 2,  label: '9' },
  { offset: 3,  label: 'b3' }, { offset: 4,  label: '3' },
  { offset: 5,  label: '11' }, { offset: 6,  label: 'b5' },
  { offset: 7,  label: '5' },  { offset: 8,  label: '#5' },
  { offset: 9,  label: '13' }, { offset: 10, label: 'b7' },
  { offset: 11, label: '7' },
];
const FB_IV_DEGREE_LABEL = Object.fromEntries(FB_IV_DEGREES.map(d => [d.offset, d.label]));

// Row grouping for the degrees dropdown — one scale-step (2nd/3rd/4th/5th/
// 6th/7th) per row, so alterations of the same step (b5/5/#5) read as one
// group instead of flowing together with everything else.
const FB_IV_DEGREE_ROWS = [[1, 2], [3, 4], [5], [6, 7, 8], [9], [10, 11]];

// Color is reserved for the flats that actually redefine chord quality
// (b3 = minor, b5 = diminished, b7 = dominant/minor7) — everything else
// (natural 3/5/7, 9/11/13, #5) renders as the plain neutral fb-shape-dot
// used everywhere else in the app, so a color always means "pay attention
// to this alteration" instead of just decorating every dot on the board.
const FB_IV_SPECIAL_DEGREE = { 3: '3', 6: '5', 10: '7' };

// Quick presets matching the chord qualities discussed in that chat — click
// one to set the degree checkboxes in one go instead of ticking them by hand.
const FB_IV_PRESETS = {
  maj7: { label: 'maj7', offsets: [4, 7, 11] },
  dom7: { label: '7',    offsets: [4, 7, 10] },
  m7:   { label: 'm7',   offsets: [3, 7, 10] },
  m7b5: { label: 'm7b5', offsets: [3, 6, 10] },
  six:  { label: '6',    offsets: [4, 7, 9] },
};

// The board always shows this fixed window (open .. 15th fret) at natural
// size — no re-centering on root change, no scaling to the panel. The user
// pans horizontally by scrolling, and that scroll position is preserved
// (fbState.iv.scrollX), so once they've framed the neck it never moves.
// Positions past the 15th fret just don't render.
const FB_IV_MAX_FRET = 15;

// Every fretted position within `halfWindow` frets either side of the root
// (clamped at fret 0) whose pitch class is the root itself or one of the
// selected degree offsets. `degrees` is a Set of semitone offsets (1-11).
function fbIvPositionsForRoot(rootString, rootFret, degrees, halfWindow = 5) {
  const rootPc = ((FB_STRING_OPEN[rootString] + rootFret) % 12 + 12) % 12;
  const startFret = Math.max(0, rootFret - halfWindow);
  const endFret = rootFret + halfWindow + 2;
  const positions = [];
  for (let s = 0; s < 6; s++) {
    for (let fret = startFret; fret <= endFret; fret++) {
      const offset = ((FB_STRING_OPEN[s] + fret - rootPc) % 12 + 12) % 12;
      const noteName = FB_NOTE_NAMES[((FB_STRING_OPEN[s] + fret) % 12 + 12) % 12];
      if (offset === 0) {
        positions.push({ stringIdx: s, fret, degree: 'R', noteName, isRoot: true, special: null });
      } else if (degrees.has(offset)) {
        positions.push({ stringIdx: s, fret, degree: FB_IV_DEGREE_LABEL[offset], noteName, isRoot: false,
                         special: FB_IV_SPECIAL_DEGREE[offset] || null });
      }
    }
  }
  return positions;
}

function fbRenderIvOptions() {
  const s = fbState.iv;
  document.getElementById('fb-iv-options').innerHTML = `
    <select onchange="fbState.iv.rootString=parseInt(this.value); fbPrefsSave(); fbIvBuild()">
      ${FB_STRING_NAMES.map((n, i) => `<option value="${i}" ${s.rootString === i ? 'selected' : ''}>${6 - i} (${n})</option>`).join('')}
    </select>
    <input type="number" min="0" max="${FB_IV_MAX_FRET}" value="${s.rootFret}" class="w-[48px]!" title="Root fret"
      onchange="fbState.iv.rootFret=Math.max(0, Math.min(${FB_IV_MAX_FRET}, parseInt(this.value) || 0)); fbPrefsSave(); fbIvBuild()">
    <div class="fb-iv-degrees-dropdown">
      <button type="button" class="btn btn-ghost btn-sm" onclick="fbIvToggleDegreesMenu(event)">Degrees ▾</button>
      <div class="fb-iv-degrees-menu" id="fb-iv-degrees-menu" onclick="event.stopPropagation()">
        ${FB_IV_DEGREE_ROWS.map(row => `
          <div class="fb-iv-degrees-row">
            ${row.map(offset => `
              <label><span class="fb-deg-swatch${FB_IV_SPECIAL_DEGREE[offset] ? ' fb-deg-' + FB_IV_SPECIAL_DEGREE[offset] : ' fb-deg-swatch-plain'}"></span>
                <input type="checkbox" ${s.degrees[offset] ? 'checked' : ''}
                onchange="fbState.iv.degrees[${offset}]=this.checked; fbPrefsSave(); fbIvBuild()"> ${FB_IV_DEGREE_LABEL[offset]}</label>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>
    ${Object.keys(FB_IV_PRESETS).map(k => `<button type="button" class="btn btn-ghost btn-sm" onclick="fbIvApplyPreset('${k}')">${FB_IV_PRESETS[k].label}</button>`).join('')}
  `;
}

// Degrees checkbox list lives in a click-to-open dropdown (11 boxes no
// longer eat a full row of the options bar). Closes on the next click
// anywhere outside it; clicks inside the menu (event.stopPropagation() in
// the markup above) don't count as "outside", so ticking several boxes in a
// row keeps it open.
function fbIvToggleDegreesMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('fb-iv-degrees-menu');
  if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
  menu.classList.add('open');
  document.addEventListener('click', () => menu.classList.remove('open'), { once: true });
}

function fbIvApplyPreset(key) {
  const preset = FB_IV_PRESETS[key];
  if (!preset) return;
  const offsets = new Set(preset.offsets);
  FB_IV_DEGREES.forEach(d => { fbState.iv.degrees[d.offset] = offsets.has(d.offset); });
  fbPrefsSave();
  fbRenderIvOptions();
  fbIvBuild();
}

// Like fbRenderShapeDegreeBoard, but each dot needs two lines of text (note
// name + degree) instead of one, so it builds its own board/dots rather than
// reusing that shared single-line renderer.
function fbIvRenderBoard(containerEl, positions) {
  const startFret = 0, numFrets = FB_IV_MAX_FRET; // fixed window — see FB_IV_MAX_FRET
  const b = fbBuildBoard(numFrets, startFret);

  // Click anywhere on the board to move the root to that string/fret; the
  // currently selected degrees (preset or hand-ticked) stay as-is. One
  // delegated listener on the svg snaps the click to the nearest
  // (string, fret) cell, so clicks landing on dots/labels work too.
  b.svg.classList.add('fb-iv-board-clickable');
  b.svg.addEventListener('click', ev => {
    const ctm = b.svg.getScreenCTM();
    if (!ctm) return;
    const pt = b.svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const loc = pt.matrixTransform(ctm.inverse());
    let bestString = 0, bestFret = startFret, bestDist = Infinity;
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i <= numFrets; i++) {
        const dx = loc.x - fbMarkerX(b, i);
        const dy = loc.y - b.yString(j);
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestString = j; bestFret = startFret + i; }
      }
    }
    const s = fbState.iv;
    s.rootString = bestString;
    s.rootFret = bestFret; // always ≤ FB_IV_MAX_FRET by construction
    fbPrefsSave();
    fbRenderIvOptions(); // sync the string select / fret input with the click
    fbIvBuild();
  });

  positions.forEach(p => {
    const cx = fbMarkerX(b, p.fret - startFret);
    const cy = b.yString(p.stringIdx);
    const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circ.setAttribute('cx', cx); circ.setAttribute('cy', cy); circ.setAttribute('r', 15);
    circ.setAttribute('class', p.isRoot ? 'fb-quiz-dot' : (p.special ? `fb-deg-dot fb-deg-${p.special}` : 'fb-shape-dot'));
    b.svg.appendChild(circ);

    // Note name on the left half, degree on the right — side by side reads
    // cleaner than stacking them, since each line is short (1-2 chars). Only
    // the root dot is solid-filled (dark), so only it needs the light/inverse
    // text variant; the hollow degree rings keep dark text on their
    // board-colored fill.
    const rootMod = p.isRoot ? ' fb-iv-label-on-root' : '';
    const noteLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    noteLabel.setAttribute('x', cx - 7); noteLabel.setAttribute('y', cy + 4);
    noteLabel.setAttribute('text-anchor', 'middle');
    noteLabel.setAttribute('class', 'fb-iv-note-label' + rootMod);
    noteLabel.textContent = p.noteName;
    b.svg.appendChild(noteLabel);

    const degreeLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    degreeLabel.setAttribute('x', cx + 8); degreeLabel.setAttribute('y', cy + 4);
    degreeLabel.setAttribute('text-anchor', 'middle');
    degreeLabel.setAttribute('class', 'fb-iv-degree-label' + rootMod);
    degreeLabel.textContent = p.degree;
    b.svg.appendChild(degreeLabel);
  });

  // Horizontal scroll is the user's manual panning — never touch it except
  // to restore what they set. Rebuilding the board replaces the .fb-board
  // element (and thereby resets its scrollLeft), so carry the previous
  // position across the rebuild; on the very first render fall back to the
  // persisted preference.
  const prev = containerEl.querySelector('.fb-board');
  const scrollX = prev ? prev.scrollLeft : fbState.iv.scrollX;
  containerEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board';
  wrap.appendChild(b.svg);
  containerEl.appendChild(wrap);
  wrap.scrollLeft = scrollX;
  wrap.addEventListener('scroll', () => {
    fbState.iv.scrollX = wrap.scrollLeft;
    clearTimeout(fbIvRenderBoard._scrollSaveTimer);
    fbIvRenderBoard._scrollSaveTimer = setTimeout(fbPrefsSave, 300);
  });
}

function fbIvBuild() {
  const s = fbState.iv;
  const degrees = new Set(Object.keys(s.degrees).map(Number).filter(k => s.degrees[k]));
  const positions = fbIvPositionsForRoot(s.rootString, s.rootFret, degrees)
    .filter(p => p.fret <= FB_IV_MAX_FRET);
  fbIvRenderBoard(document.getElementById('fb-iv-board'), positions);
}

// ── Interval Shapes: floating-panel chrome ──────────────────────────────
// Page-independent (like the practice timer pill and the agent panel) — the
// panel lives outside any .page div in index.html, so this tool works from
// any page without navigating to Fretboard. Opened from the tools menu
// (app.js toolsMenu*), not its own fixed toggle button. The panel is both
// draggable (like the transport pill) and resizable (like the agent panel,
// dragging its top-left handle while keeping the opposite corner fixed).

function fbIvSetOpenUI(open) {
  document.getElementById('fbiv-panel')?.classList.toggle('open', open);
}

function fbIvOpen() {
  fbState.iv.open = true;
  fbIvSetOpenUI(true);
  fbPrefsSave();
}

function fbIvClose() {
  fbState.iv.open = false;
  fbIvSetOpenUI(false);
  fbPrefsSave();
}

function fbIvApplyPos() {
  const panel = document.getElementById('fbiv-panel');
  if (!panel || fbState.iv._dragging) return;
  const w = fbState.iv.width, h = fbState.iv.height;
  let x, y;
  if (fbState.iv.pos) { x = fbState.iv.pos.x; y = fbState.iv.pos.y; }
  // Default: bottom-left, above the tools-menu launcher that opens it —
  // deliberately the opposite corner from AI 助教, so an open panel never
  // covers the agent panel.
  else { x = 20; y = window.innerHeight - h - 20; }
  x = Math.max(4, Math.min(window.innerWidth  - w - 4, x));
  y = Math.max(4, Math.min(window.innerHeight - h - 4, y));
  panel.style.left = x + 'px'; panel.style.top = y + 'px';
  panel.style.right = 'auto'; panel.style.bottom = 'auto';
  panel.style.width = w + 'px'; panel.style.height = h + 'px';
}

function fbIvInitDrag() {
  const panel = document.getElementById('fbiv-panel');
  const head = document.getElementById('fbiv-head');
  if (!panel || !head) return;
  const onButtons = e => e.target.closest('button');
  let sx, sy, ox, oy, dragging = false;
  head.addEventListener('pointerdown', e => {
    if (onButtons(e)) return;
    dragging = true; fbState.iv._dragging = true; panel.classList.add('dragging');
    const r = panel.getBoundingClientRect();
    ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
    head.setPointerCapture(e.pointerId); e.preventDefault();
  });
  head.addEventListener('pointermove', e => {
    if (!dragging) return;
    let x = ox + (e.clientX - sx), y = oy + (e.clientY - sy);
    x = Math.max(4, Math.min(window.innerWidth  - panel.offsetWidth  - 4, x));
    y = Math.max(4, Math.min(window.innerHeight - panel.offsetHeight - 4, y));
    panel.style.left = x + 'px'; panel.style.top = y + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
  });
  head.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false; fbState.iv._dragging = false; panel.classList.remove('dragging');
    fbState.iv.pos = { x: parseInt(panel.style.left), y: parseInt(panel.style.top) };
    fbPrefsSave();
  });
  head.addEventListener('pointercancel', () => {
    dragging = false; fbState.iv._dragging = false; panel.classList.remove('dragging');
  });
  head.addEventListener('dblclick', e => { // reset to the default spot
    if (onButtons(e)) return;
    fbState.iv.pos = null; fbPrefsSave(); fbIvApplyPos();
  });
  window.addEventListener('resize', () => fbIvApplyPos());
}

// Drag the bottom-right corner handle — the standard OS-window resize spot,
// growing away from the fixed top-left corner (this panel is draggable, so
// unlike the agent panel there's no "anchored" corner to keep tethered).
function fbIvInitResize() {
  const handle = document.getElementById('fbiv-resize-handle');
  const panel = document.getElementById('fbiv-panel');
  if (!handle || !panel) return;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startRect = panel.getBoundingClientRect();
    const startW = fbState.iv.width, startH = fbState.iv.height;
    const maxW = window.innerWidth - startRect.left - 4;
    const maxH = window.innerHeight - startRect.top - 4;
    function onMove(ev) {
      const w = Math.max(360, Math.min(maxW, startW + (ev.clientX - startX)));
      const h = Math.max(320, Math.min(maxH, startH + (ev.clientY - startY)));
      fbState.iv.width = w; fbState.iv.height = h;
      panel.style.width = w + 'px'; panel.style.height = h + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      fbPrefsSave();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// Page-independent init — called once from app.js's init(), alongside
// ptInit()/agentInit(), not gated behind ever visiting the Fretboard page.
function fbIvInit() {
  fbEnsurePrefsLoaded();
  fbIvApplyPos();
  fbIvInitDrag();
  fbIvInitResize();
  fbIvSetOpenUI(fbState.iv.open);
  fbRenderIvOptions();
  fbIvBuild();
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FB_IV_DEGREES, FB_IV_DEGREE_LABEL, FB_IV_DEGREE_ROWS, FB_IV_SPECIAL_DEGREE, FB_IV_PRESETS, FB_IV_MAX_FRET,
    fbIvPositionsForRoot, fbRenderIvOptions, fbIvToggleDegreesMenu, fbIvApplyPreset, fbIvRenderBoard, fbIvBuild,
    fbIvSetOpenUI, fbIvOpen, fbIvClose, fbIvApplyPos, fbIvInitDrag, fbIvInitResize,
    fbIvInit,
  };
}
