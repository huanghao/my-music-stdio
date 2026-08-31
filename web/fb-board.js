// ── Fretboard trainer — shared SVG board drawing ──
// Split out of web/fretboard.js (pure code move, no logic changes).

// ── Shared SVG board drawing ──

function fbBuildBoard(numFrets, startFret) {
  const FRET_W = 78, STRING_H = 42, PAD_L = 58, PAD_T = 34, PAD_R = 26, PAD_B = 42;
  const width = PAD_L + numFrets * FRET_W + PAD_R;
  const height = PAD_T + 5 * STRING_H + PAD_B;
  const xFret = i => PAD_L + i * FRET_W;             // i = 0..numFrets (fret line index)
  // j is still the string index (0 = low E .. 5 = high e), but the standard
  // horizontal fretboard convention draws high e on top and low E on the
  // bottom (matches TAB and how a player looks down at their own neck) —
  // so row position is inverted relative to the index.
  const yString = j => PAD_T + (5 - j) * STRING_H;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const ns = 'http://www.w3.org/2000/svg';
  const line = (x1, y1, x2, y2, cls) => {
    const el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('class', cls);
    svg.appendChild(el);
    return el;
  };
  const text = (x, y, str, cls, anchor = 'middle') => {
    const el = document.createElementNS(ns, 'text');
    el.setAttribute('x', x); el.setAttribute('y', y);
    el.setAttribute('class', cls);
    el.setAttribute('text-anchor', anchor);
    el.textContent = str;
    svg.appendChild(el);
    return el;
  };
  const circle = (cx, cy, r, cls) => {
    const el = document.createElementNS(ns, 'circle');
    el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    el.setAttribute('class', cls);
    svg.appendChild(el);
    return el;
  };

  // 12th-fret (and 24th, same octave-marker rule as the double inlay dot
  // below) gets a very faint background tint — drawn first so strings/frets/
  // markers all paint on top of it. It's the one fret every player anchors
  // on, worth a subtle visual landmark.
  for (let i = 1; i <= numFrets; i++) {
    const absFret = startFret + i;
    if (absFret > 0 && absFret % 12 === 0) {
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', xFret(i - 1)); rect.setAttribute('y', yString(5));
      rect.setAttribute('width', xFret(i) - xFret(i - 1)); rect.setAttribute('height', yString(0) - yString(5));
      rect.setAttribute('class', 'fb-octave-bg');
      svg.appendChild(rect);
    }
  }

  // strings (horizontal)
  for (let j = 0; j < 6; j++) {
    line(xFret(0), yString(j), xFret(numFrets), yString(j), 'fb-string');
  }
  // fret lines (vertical)
  for (let i = 0; i <= numFrets; i++) {
    const isNut = startFret === 0 && i === 0;
    line(xFret(i), yString(0), xFret(i), yString(5), isNut ? 'fb-nut' : 'fb-fretline');
  }
  // inlay dots + fret numbers. Standard guitar convention: single dot at
  // 3/5/7/9 (and again an octave up at 15/17/19/21), double dot at the
  // octave marker itself (12, 24, ...) — not every marked fret gets the
  // same single dot. Both are pushed further from the string rows than
  // their own size would need, so a note marker (r=15) sitting on the top
  // or bottom string doesn't cover them.
  const SINGLE_DOT_FRET_MODS = [3, 5, 7, 9];
  for (let i = 1; i <= numFrets; i++) {
    const absFret = startFret + i;
    const cx = (xFret(i - 1) + xFret(i)) / 2;
    if (absFret > 0 && absFret % 12 === 0) {
      circle(cx, yString(0) + 26 - 6, 4, 'fb-inlay');
      circle(cx, yString(0) + 26 + 6, 4, 'fb-inlay');
    } else if (SINGLE_DOT_FRET_MODS.includes(absFret % 12)) {
      circle(cx, yString(0) + 26, 4, 'fb-inlay'); // below the visually-bottom row (string index 0, low E)
    }
    text(cx, yString(5) - 20, String(absFret), 'fb-fret-num'); // above the top (high e) row
  }
  if (startFret > 0) {
    text(xFret(0) - 14, (yString(0) + yString(5)) / 2, startFret + 'fr', 'fb-fret-num', 'end');
  }

  // string names at the headstock side (only makes sense where the nut is shown)
  if (startFret === 0) {
    FB_STRING_NAMES.forEach((n, j) => {
      text(xFret(0) - 34, yString(j) + 5, n, 'fb-string-name', 'middle');
    });
  }

  return { svg, xFret, yString, PAD_L, FRET_W };
}

function fbMarkerX(b, fretIdx) {
  // fretIdx is relative to the window (0 = open/nut of this window)
  return fretIdx === 0 ? b.xFret(0) : (b.xFret(fretIdx - 1) + b.xFret(fretIdx)) / 2;
}

// A consistent header above each drill's accuracy table — same title/reset
// layout everywhere, so "Reset stats" always lives in one predictable spot
// instead of being scattered into each drill's options row.
function fbStatsTableHead(title, resetFn) {
  return `<div class="fb-stats-table-head"><span>${title}</span>` +
    `<button class="btn btn-ghost btn-sm danger" onclick="${resetFn}()">Reset stats</button></div>`;
}

// shape: { frets: [6 values, 'x' or fret-offset], rootString, rootFret }
// Standard vertical chord-box diagram (the convention used in every chord
// book / Ultimate Guitar / etc.): strings are vertical lines, low E on the
// left through high e on the right; frets are horizontal lines, the nut (or
// the barre reference fret) at the top, increasing downward. Rendered via
// the svguitar library (MIT, https://github.com/omnibrain/svguitar) rather
// than hand-rolled SVG — a hand-rolled version of this had a real off-by-one
// bug (fretted notes drawn a row too high whenever the diagram didn't start
// at the nut), and getting chord-box geometry exactly right is a solved
// problem not worth re-solving by hand.
//
// svguitar's own conventions (verified against its README example, not just
// assumed): string numbers run 1 (high e) → 6 (low E) — opposite of this
// file's internal low-to-high indexing — and relative fret numbers are
// 1-indexed starting at the diagram's first row (so shape offset v=0, "the
// barre/reference position itself", is relative fret 1, not 0). `position`
// is the real starting fret shown in the first row; 1 doubles as "show the
// nut" when the shape is genuinely unbarred.
function fbShapeToSvguitarChord(shape, barreFret, degreeLabels, forceNoBarre = false) {
  const fingers = [];
  const barredMyIndices = [];
  shape.frets.forEach((v, i) => {
    const svString = 6 - i; // my index 0 (low E) -> string 6, index 5 (high e) -> string 1
    if (v === 'x') {
      fingers.push([svString, svguitar.SILENT]);
      return;
    }
    const isRoot = i === shape.rootString && v === shape.rootFret;
    const label = degreeLabels && degreeLabels[i] ? degreeLabels[i] : undefined;
    if (v === 0 && barreFret === 0) {
      fingers.push([svString, svguitar.OPEN, label ? { text: label } : undefined]);
      return;
    }
    if (v === 0) barredMyIndices.push(i);
    // shape offset v -> relative fret (1-indexed from svguitar's `position`).
    // When barred (barreFret > 0), position === barreFret, so relFret = v + 1.
    // When genuinely open (barreFret === 0), svguitar's position is pinned to
    // the sentinel value 1 (not 0) to draw the nut, which shifts the mapping:
    // relFret = (absoluteFret - position) + 1 = (v - 1) + 1 = v.
    const relFret = barreFret === 0 ? v : v + 1;
    const opts = { color: isRoot ? '#b8843a' : '#4a7c4a' };
    if (label) opts.text = label;
    fingers.push([svString, relFret, opts]);
  });

  const barres = [];
  if (!forceNoBarre && barreFret > 0 && barredMyIndices.length > 1) {
    // my low-to-high index order is the reverse of svguitar's string numbering
    barres.push({
      fromString: 6 - Math.min(...barredMyIndices),
      toString: 6 - Math.max(...barredMyIndices),
      fret: 1,
    });
  }

  // Dynamic fret-row count: use only as many rows as the chord needs (min 2).
  // Same logic as the chord reference sheet.
  let maxFret = 1;
  fingers.forEach(f => { if (typeof f[1] === 'number') maxFret = Math.max(maxFret, f[1]); });
  barres.forEach(b => { if (b.fret > maxFret) maxFret = b.fret; });
  const fretsToShow = Math.max(2, maxFret);

  return { fingers, barres, position: barreFret === 0 ? 1 : barreFret, fretsToShow };
}

// Apply the chord diagram size.
// 1) Sets CSS variable so newly-rendered cards pick up the size.
// 2) Directly patches existing .fb-shape-card elements for immediate feedback
//    (the CSS cascade alone can lag behind when cards are already in the DOM).
function fbApplyDiagramSize() {
  const px = (fbState.chord.diagramSize || 200) + 'px';
  document.documentElement.style.setProperty('--fb-diagram-size', px);
  document.querySelectorAll('.fb-shape-card').forEach(function(card) {
    card.style.width = px;
  });
}

function fbRenderShapeBox(containerEl, shape, barreFret, degreeLabels, forceNoBarre = false) {
  containerEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'fb-board fb-svguitar-box';
  containerEl.appendChild(box);
  const { fingers, barres, position, fretsToShow } = fbShapeToSvguitarChord(shape, barreFret, degreeLabels, forceNoBarre);
  new svguitar.SVGuitarChord(box)
    .configure({
      strings: 6, frets: fretsToShow,
      tuning: FB_STRING_NAMES,
      color: '#8a8578',
      fingerColor: '#4a7c4a',
      fingerTextColor: '#fff',
      barreChordStrokeWidth: 0,
      fretLabelFontSize: 32,
      tuningsFontSize: 24,
    })
    .chord({ fingers, barres, position })
    .draw();
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fbBuildBoard, fbMarkerX, fbStatsTableHead, fbShapeToSvguitarChord, fbApplyDiagramSize, fbRenderShapeBox,
  };
}
