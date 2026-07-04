// ── Fretboard trainer: note names + CAGED chord shapes ──
// Standalone module, no server dependency. Hooked from showPage('fretboard') in app.js.

// Leading-edge debounce for action buttons.  Fires immediately on first call,
// then blocks for `ms` ms to prevent rapid double-clicks from double-advancing
// or double-playing.  Used to wrap "Next →", "Play", "New …" functions below.
function guarded(fn, ms = 400) {
  let blocked = false;
  return function(...args) {
    if (blocked) return;
    blocked = true;
    setTimeout(() => { blocked = false; }, ms);
    return fn.apply(this, args);
  };
}

const FB_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
// low string (6th) → high string (1st)
const FB_STRING_NAMES = ['E','A','D','G','B','E'];
const FB_STRING_OPEN  = [4, 9, 2, 7, 11, 4];

function fbNoteAt(stringIdx, fret) {
  return FB_NOTE_NAMES[(FB_STRING_OPEN[stringIdx] + fret) % 12];
}

// MIDI note numbers of open strings, low → high (standard tuning).
const FB_STRING_OPEN_MIDI = [40, 45, 50, 55, 59, 64];
function fbFreqFromMidi(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function fbOctaveOf(midi) { return Math.floor(midi / 12) - 1; }

// Open-position CAGED shapes: fret offsets from the shape's own "fret 0",
// low string (index 0) → high string (index 5). 'x' = muted.
const FB_CAGED_SHAPES = {
  E: { frets: [0, 2, 2, 1, 0, 0], rootString: 0, rootFret: 0 },
  A: { frets: ['x', 0, 2, 2, 2, 0], rootString: 1, rootFret: 0 },
  D: { frets: ['x', 'x', 0, 2, 3, 2], rootString: 2, rootFret: 0 },
  G: { frets: [3, 2, 0, 0, 0, 3], rootString: 0, rootFret: 3 },
  C: { frets: ['x', 3, 2, 0, 1, 0], rootString: 1, rootFret: 3 },
};
const FB_SHAPE_ORDER = ['C', 'A', 'G', 'E', 'D'];

// shape needs { rootString, rootFret }. rootNote/target can be a note name or a 0-11 pitch class index.
function fbBarreFretForShape(target, shape) {
  const targetPc = typeof target === 'string' ? FB_NOTE_NAMES.indexOf(target) : target;
  const open = FB_STRING_OPEN[shape.rootString];
  return ((targetPc - open - shape.rootFret) % 12 + 12) % 12;
}

function fbBarreFretFor(rootNote, shapeLetter) {
  return fbBarreFretForShape(rootNote, FB_CAGED_SHAPES[shapeLetter]);
}

const fbState = {
  inited: false,
  notes: { strings: [true, true, true, true, true, true], maxFret: 12, correct: 0, total: 0, streak: 0, current: null, locked: false },
  caged: { mode: 'barre', correct: 0, total: 0, streak: 0, current: null, answered: false },
  pitch: { target: null, matches: 0, total: 0, streak: 0, matched: false, startTime: 0,
           strings: [true, true, true, true, true, true], practiceMode: 'all', stats: {},
           showBoard: false,
           _holdCount: 0, _wrongNote: null, _wrongHoldCount: 0, _lastWrongMsgAt: -Infinity },
  tuner: { tuned: [false, false, false, false, false, false], activeString: -1, _holdCount: 0, _holdString: -1 },
  chord: { target: null, matches: 0, total: 0, streak: 0, matched: false, startTime: 0,
           qualities: { '': true, m: true, maj7: true, '7': true, m7: true, dim7: true, m7b5: true, sus2: false, sus4: false },
           notationStyle: 'standard', showFormula: false, showDegreesOnDiagram: false, showChordDiagram: false, diagramSize: 200,
           source: 'random', fixedRoot: 0, progression: { def: null, keyRoot: 0, chords: null, stepIdx: 0 },
           stats: {},
           _holdCount: 0, _wrongSymbol: null, _wrongHoldCount: 0, _lastWrongMsgAt: -Infinity,
           _hiddenMs: 0, _hiddenSince: null },
  keymap: { mode: 'relative',
            relative: { correct: 0, total: 0, streak: 0, current: null, locked: false },
            degree: { fullSet: false, correct: 0, total: 0, streak: 0, current: null, answered: false } },
  shapeDegree: { mode: 'identify',
                 shapes: [true, true, true, true, true], // one per FB_SHAPE_ORDER entry (C,A,G,E,D)
                 identify: { correct: 0, total: 0, streak: 0, current: null, locked: false },
                 locate: { correct: 0, total: 0, streak: 0, current: null, answered: false } },
  ear: { scale: 'minor', mode: 'two', autoAdvance: true, wrongPauseSec: 3, showDiagram: true, waveform: 'sine',
         playbackStyle: 'melodic', noteGapSec: 0.25, direction: 'both', range: 'mid',
         two: { correct: 0, total: 0, streak: 0, current: null, answered: false, timeoutId: null,
                playingUntil: 0, exploreFirstIdx: null, exploreArc: null, diagramCurrent: null },
         three: { correct: 0, total: 0, streak: 0, current: null, answered: false, step: 1, step1Correct: null, timeoutId: null,
                  playingUntil: 0, exploreFirstIdx: null, exploreArc: null, diagramCurrent: null } },
  bend: {
    subMode: 'bend', string: 4, interval: 'full',
    phase: 'idle', baseFreq: null, _stableFr: 0, _holdFr: 0, _lastFreq: null, _nextAt: null, _history: [], _lastFreqTs: null, _smoothedCents: null,
    current: null, correct: 0, total: 0, streak: 0,
  },
  vibrato: {
    targetHz: 5, phase: 'idle', baseFreq: null,
    _history: [], _stableFr: 0, _lastFreq: null, _successFr: 0, _startTime: null,
    correct: 0, total: 0, speed: null, depth: null,
  },
};

// Global, not scoped to the Fretboard page — every mic-based drill here and
// Speed Trainer's metronome all share the same fbMic/fbOutput singletons, so
// this is rendered once at app startup (see init() in app.js), not gated
// behind visiting any particular page.
function fbRenderDeviceBar() {
  document.getElementById('fb-device-bar').innerHTML = `
    <span>Input device:</span>
    <select class="fb-device-select" onchange="fbMicDeviceChange(this.value)"><option value="">Default (grant mic access first)</option></select>
    ${fbOutputDeviceSelectHtml()}
  `;
  fbRefreshOutputDevices();
}

function initFretboardPage() {
  if (fbState.inited) return;
  fbState.inited = true;
  fbPrefsLoad();
  fbApplyDiagramSize();  // apply saved diagram size as CSS variable
  fbPitchLoadStats();
  fbRenderNotesOptions();
  fbNotesNext();
  fbCagedNext();
  fbRenderShapeDegreeOptions();
  fbShapeDegreeIdentifyNext();
  fbShapeDegreeLocateNext();
  fbCagedSetMode(fbState.caged.mode);
  fbShapeDegreeSetMode(fbState.shapeDegree.mode);
  fbRenderEarOptions();
  fbEarTwoNext();
  fbEarThreeNext();
  fbEarSetMode(fbState.ear.mode);
  fbRenderPitchOptions();
  fbPitchNewNote();
  fbRenderPitchStatsTable();
  fbRenderTunerStrings();
  fbChordLoadStats();
  fbRenderChordOptions();
  fbChordNewChord();
  fbRenderChordStatsTable();
  fbRelativeNext();
  fbRenderDegreeOptions();
  fbDegreeNext();
  fbKeymapSetMode(fbState.keymap.mode);
  fbBendInit();
}

function fbShowMode(mode) {
  if (fbMic.listening) {
    fbMicStop();
    fbSyncMicButtons('pitch');
    fbSyncMicButtons('tuner');
    fbSyncMicButtons('chord');
    fbSyncMicButtons('bend');
    document.getElementById('fb-pitch-meter').innerHTML = '';
    document.getElementById('fb-tuner-meter').innerHTML = '';
    fbRenderChroma(new Array(12).fill(0), null);
  }
  document.querySelectorAll('.fb-tab').forEach(b => b.classList.toggle('active', b.dataset.fbmode === mode));
  document.querySelectorAll('.fb-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('fb-' + mode).classList.add('active');
}

// releases the mic when navigating away from the Fretboard page entirely
function fbLeavePage() {
  if (fbMic.listening) fbMicStop();
}

// ── Practice preferences (persisted across sessions, separate from stats) ──

const FB_PREFS_KEY = 'fb_prefs';

function fbPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FB_PREFS_KEY)) || {}; } catch (_) { saved = {}; }
  if (saved.notes) {
    if (Array.isArray(saved.notes.strings) && saved.notes.strings.length === 6) fbState.notes.strings = saved.notes.strings;
    if (saved.notes.maxFret === 5 || saved.notes.maxFret === 12) fbState.notes.maxFret = saved.notes.maxFret;
  }
  if (saved.pitch) {
    if (Array.isArray(saved.pitch.strings) && saved.pitch.strings.length === 6) fbState.pitch.strings = saved.pitch.strings;
    if (saved.pitch.practiceMode === 'all' || saved.pitch.practiceMode === 'weak') fbState.pitch.practiceMode = saved.pitch.practiceMode;
    if (typeof saved.pitch.showBoard === 'boolean') fbState.pitch.showBoard = saved.pitch.showBoard;
  }
  if (saved.chord && saved.chord.qualities) {
    Object.keys(fbState.chord.qualities).forEach(k => {
      if (typeof saved.chord.qualities[k] === 'boolean') fbState.chord.qualities[k] = saved.chord.qualities[k];
    });
  }
  if (saved.chord && (saved.chord.notationStyle === 'standard' || saved.chord.notationStyle === 'jazz')) {
    fbState.chord.notationStyle = saved.chord.notationStyle;
  }
  if (saved.chord && typeof saved.chord.showFormula === 'boolean') fbState.chord.showFormula = saved.chord.showFormula;
  if (saved.chord && typeof saved.chord.showDegreesOnDiagram === 'boolean') fbState.chord.showDegreesOnDiagram = saved.chord.showDegreesOnDiagram;
  if (saved.chord && typeof saved.chord.showChordDiagram === 'boolean') fbState.chord.showChordDiagram = saved.chord.showChordDiagram;
  if (saved.chord && typeof saved.chord.diagramSize === 'number') fbState.chord.diagramSize = saved.chord.diagramSize;
  if (saved.chord && ['random', 'progression', 'fixed_root'].includes(saved.chord.source)) fbState.chord.source = saved.chord.source;
  if (saved.chord && Number.isInteger(saved.chord.fixedRoot) && saved.chord.fixedRoot >= 0 && saved.chord.fixedRoot < 12) fbState.chord.fixedRoot = saved.chord.fixedRoot;
  if (saved.keymap && (saved.keymap.mode === 'relative' || saved.keymap.mode === 'degree')) {
    fbState.keymap.mode = saved.keymap.mode;
  }
  if (saved.keymap && typeof saved.keymap.degreeFullSet === 'boolean') {
    fbState.keymap.degree.fullSet = saved.keymap.degreeFullSet;
  }
  if (saved.caged && (saved.caged.mode === 'barre' || saved.caged.mode === 'degrees')) {
    fbState.caged.mode = saved.caged.mode;
  }
  if (saved.shapeDegree && (saved.shapeDegree.mode === 'identify' || saved.shapeDegree.mode === 'locate')) {
    fbState.shapeDegree.mode = saved.shapeDegree.mode;
  }
  if (saved.shapeDegree && Array.isArray(saved.shapeDegree.shapes) && saved.shapeDegree.shapes.length === 5) {
    fbState.shapeDegree.shapes = saved.shapeDegree.shapes;
  }
  if (saved.ear && Object.prototype.hasOwnProperty.call(FB_EAR_SCALES, saved.ear.scale)) {
    fbState.ear.scale = saved.ear.scale;
  }
  if (saved.ear && (saved.ear.mode === 'two' || saved.ear.mode === 'three')) {
    fbState.ear.mode = saved.ear.mode;
  }
  if (saved.ear && typeof saved.ear.autoAdvance === 'boolean') {
    fbState.ear.autoAdvance = saved.ear.autoAdvance;
  }
  if (saved.ear && typeof saved.ear.wrongPauseSec === 'number' && saved.ear.wrongPauseSec > 0) {
    fbState.ear.wrongPauseSec = saved.ear.wrongPauseSec;
  }
  if (saved.ear && typeof saved.ear.showDiagram === 'boolean') {
    fbState.ear.showDiagram = saved.ear.showDiagram;
  }
  if (saved.ear && ['sine', 'triangle', 'square', 'sawtooth'].includes(saved.ear.waveform)) {
    fbState.ear.waveform = saved.ear.waveform;
  }
  if (saved.ear && ['melodic', 'harmonic', 'both'].includes(saved.ear.playbackStyle)) {
    fbState.ear.playbackStyle = saved.ear.playbackStyle;
  }
  if (saved.ear && typeof saved.ear.noteGapSec === 'number' && saved.ear.noteGapSec >= 0) {
    fbState.ear.noteGapSec = saved.ear.noteGapSec;
  }
  if (saved.ear && ['asc', 'desc', 'both'].includes(saved.ear.direction)) {
    fbState.ear.direction = saved.ear.direction;
  }
  if (saved.ear && Object.prototype.hasOwnProperty.call(FB_EAR_RANGE_BASE, saved.ear.range)) {
    fbState.ear.range = saved.ear.range;
  }
  if (saved.bend) {
    if (saved.bend.subMode === 'bend' || saved.bend.subMode === 'vibrato') fbState.bend.subMode = saved.bend.subMode;
    if ([3, 4, 5].includes(+saved.bend.string)) fbState.bend.string = +saved.bend.string;
    if (['half', 'full', 'full_half'].includes(saved.bend.interval)) fbState.bend.interval = saved.bend.interval;
  }
  if (saved.vibrato && [3, 5, 7].includes(+saved.vibrato.targetHz)) {
    fbState.vibrato.targetHz = +saved.vibrato.targetHz;
  }
}

function fbPrefsSave() {
  localStorage.setItem(FB_PREFS_KEY, JSON.stringify({
    notes: { strings: fbState.notes.strings, maxFret: fbState.notes.maxFret },
    pitch: { strings: fbState.pitch.strings, practiceMode: fbState.pitch.practiceMode, showBoard: fbState.pitch.showBoard },
    chord: {
      qualities: fbState.chord.qualities,
      notationStyle: fbState.chord.notationStyle,
      showFormula: fbState.chord.showFormula, showDegreesOnDiagram: fbState.chord.showDegreesOnDiagram,
      showChordDiagram: fbState.chord.showChordDiagram,
      diagramSize: fbState.chord.diagramSize,
      source: fbState.chord.source, fixedRoot: fbState.chord.fixedRoot,
    },
    keymap: { mode: fbState.keymap.mode, degreeFullSet: fbState.keymap.degree.fullSet },
    caged: { mode: fbState.caged.mode },
    shapeDegree: { mode: fbState.shapeDegree.mode, shapes: fbState.shapeDegree.shapes },
    ear: { scale: fbState.ear.scale, mode: fbState.ear.mode, autoAdvance: fbState.ear.autoAdvance,
           wrongPauseSec: fbState.ear.wrongPauseSec, showDiagram: fbState.ear.showDiagram, waveform: fbState.ear.waveform,
           playbackStyle: fbState.ear.playbackStyle, noteGapSec: fbState.ear.noteGapSec, direction: fbState.ear.direction,
           range: fbState.ear.range },
    bend: { subMode: fbState.bend.subMode, string: fbState.bend.string, interval: fbState.bend.interval },
    vibrato: { targetHz: fbState.vibrato.targetHz },
  }));
}

// ── Shared SVG board drawing ──

function fbBuildBoard(numFrets, startFret) {
  const FRET_W = 78, STRING_H = 42, PAD_L = 58, PAD_T = 26, PAD_R = 26, PAD_B = 34;
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
  // same single dot.
  const SINGLE_DOT_FRET_MODS = [3, 5, 7, 9];
  for (let i = 1; i <= numFrets; i++) {
    const absFret = startFret + i;
    const cx = (xFret(i - 1) + xFret(i)) / 2;
    if (absFret > 0 && absFret % 12 === 0) {
      circle(cx, yString(0) + 16 - 6, 4, 'fb-inlay');
      circle(cx, yString(0) + 16 + 6, 4, 'fb-inlay');
    } else if (SINGLE_DOT_FRET_MODS.includes(absFret % 12)) {
      circle(cx, yString(0) + 16, 4, 'fb-inlay'); // below the visually-bottom row (string index 0, low E)
    }
    text(cx, yString(5) - 10, String(absFret), 'fb-fret-num'); // above the top (high e) row
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

// ── Note Names drill ──

function fbRenderNotesOptions() {
  const el = document.getElementById('fb-notes-options');
  el.innerHTML = `
    <span>Strings:</span>
    ${FB_STRING_NAMES.map((n, i) => `
      <label><input type="checkbox" data-str="${i}" ${fbState.notes.strings[i] ? 'checked' : ''} onchange="fbToggleString(${i})"> ${n}${i===0?'(low)':i===5?'(high)':''}</label>
    `).join('')}
    <span style="margin-left:12px">Frets:</span>
    <select onchange="fbState.notes.maxFret=parseInt(this.value); fbPrefsSave(); fbNotesNext()">
      <option value="5" ${fbState.notes.maxFret===5?'selected':''}>0–5</option>
      <option value="12" ${fbState.notes.maxFret===12?'selected':''}>0–12</option>
    </select>
  `;
}

function fbToggleString(i) {
  fbState.notes.strings[i] = !fbState.notes.strings[i];
  if (!fbState.notes.strings.some(Boolean)) fbState.notes.strings[i] = true; // keep at least one
  fbPrefsSave();
  fbNotesNext();
}

function fbRenderNotesStats() {
  const s = fbState.notes;
  document.getElementById('fb-notes-stats').innerHTML = `
    <span class="fb-stat-ok">Correct <b>${s.correct}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbNotesNext() {
  const s = fbState.notes;
  s.locked = false;
  const eligible = [];
  for (let i = 0; i < 6; i++) if (s.strings[i]) eligible.push(i);
  const stringIdx = eligible[Math.floor(Math.random() * eligible.length)];
  const fret = Math.floor(Math.random() * (s.maxFret + 1));
  s.current = { stringIdx, fret, note: fbNoteAt(stringIdx, fret) };

  fbRenderNotesStats();
  document.getElementById('fb-notes-feedback').textContent = '';
  document.getElementById('fb-notes-feedback').className = 'fb-feedback';

  const b = fbBuildBoard(12, 0);
  const cls = fret === 0 ? 'fb-open-marker' : 'fb-quiz-dot';
  const r = fret === 0 ? 10 : 11;
  const cx = fbMarkerX(b, fret);
  const cy = b.yString(stringIdx);
  const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circ.setAttribute('cx', cx); circ.setAttribute('cy', cy); circ.setAttribute('r', r);
  circ.setAttribute('class', cls);
  b.svg.appendChild(circ);

  const boardEl = document.getElementById('fb-notes-board');
  boardEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board';
  wrap.appendChild(b.svg);
  boardEl.appendChild(wrap);

  const ansEl = document.getElementById('fb-notes-answers');
  ansEl.innerHTML = FB_NOTE_NAMES.map(n => `<button class="fb-answer-btn" onclick="fbNotesAnswer('${n}', this)">${n}</button>`).join('');
}

function fbNotesAnswer(note, btnEl) {
  const s = fbState.notes;
  if (s.locked) return;
  s.locked = true;
  s.total++;
  const correct = note === s.current.note;
  if (correct) { s.correct++; s.streak++; } else { s.streak = 0; }

  document.querySelectorAll('#fb-notes-answers .fb-answer-btn').forEach(b => {
    if (b.textContent === s.current.note) b.classList.add('correct');
    else if (b === btnEl && !correct) b.classList.add('wrong');
  });

  const fb = document.getElementById('fb-notes-feedback');
  const posLabel = `${FB_STRING_NAMES[s.current.stringIdx]} string, fret ${s.current.fret}`;
  fb.textContent = correct ? `Correct — ${posLabel} = ${s.current.note}` : `${posLabel} = ${s.current.note}, not ${note}`;
  fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
  fbRenderNotesStats();

  setTimeout(fbNotesNext, correct ? 500 : 1300);
}

// ── CAGED Shapes drill ──

function fbCagedSetMode(mode) {
  fbState.caged.mode = mode;
  fbPrefsSave();
  document.querySelectorAll('#fb-caged-mode-tabs .fb-subtab').forEach(b => b.classList.toggle('active', b.dataset.cagedmode === mode));
  document.getElementById('fb-caged-barre-panel').style.display = mode === 'barre' ? '' : 'none';
  document.getElementById('fb-caged-degrees-panel').style.display = mode === 'degrees' ? '' : 'none';
}

function fbRenderCagedStats() {
  const s = fbState.caged;
  document.getElementById('fb-caged-stats').innerHTML = `
    <span class="fb-stat-ok">Correct <b>${s.correct}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbCagedNext() {
  const s = fbState.caged;
  const root = FB_NOTE_NAMES[Math.floor(Math.random() * 12)];
  const shape = FB_SHAPE_ORDER[Math.floor(Math.random() * FB_SHAPE_ORDER.length)];
  const barreFret = fbBarreFretFor(root, shape);
  s.current = { root, shape, barreFret };
  s.answered = false;

  fbRenderCagedStats();
  document.getElementById('fb-caged-prompt').innerHTML =
    `Play <b>${root} major</b> using the <b>${shape}-shape</b> (CAGED). Which fret is the shape's reference (barre) position?`;
  document.getElementById('fb-caged-fret').value = '';
  document.getElementById('fb-caged-feedback').textContent = '';
  document.getElementById('fb-caged-feedback').className = 'fb-feedback';
  document.getElementById('fb-caged-board').innerHTML = '';
}

function fbCagedCheck() {
  const s = fbState.caged;
  if (s.answered) return;
  const input = document.getElementById('fb-caged-fret');
  const val = parseInt(input.value);
  if (Number.isNaN(val)) return;
  s.answered = true;
  s.total++;
  const correct = ((val % 12) + 12) % 12 === s.current.barreFret;
  if (correct) { s.correct++; s.streak++; } else { s.streak = 0; }

  const fb = document.getElementById('fb-caged-feedback');
  fb.textContent = correct
    ? `Correct — fret ${s.current.barreFret}`
    : `Fret ${s.current.barreFret} (you said ${val})`;
  fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
  fbRenderCagedStats();
  fbRenderCagedDiagram(s.current.shape, s.current.barreFret);
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

function fbRenderCagedDiagram(shapeLetter, barreFret) {
  fbRenderShapeBox(document.getElementById('fb-caged-board'), FB_CAGED_SHAPES[shapeLetter], barreFret, null);
}

// ── Shape Degrees drill ──
// The 5 CAGED shapes are movable major-triad shapes: every fretted note in
// one is the root, 3rd, or 5th, and which one it is never changes regardless
// of which actual root the shape is barred to (see fbShapeDegreeLabels,
// defined below with the Chord Match code that introduced it). This drill
// tests that shape-relative map directly: "Identify" shows one position
// highlighted and asks its degree; "Locate" gives a degree and asks you to
// click a matching position. Both are the same lookup fbBarreFretFor already
// does for the barre-fret drill above, just at finer grain (per-string
// degree instead of "where's the root").

// Pure (no Math.random) so it's unit-testable: absolute fret + scale degree
// for every fretted string of `shape` when barred at `barreFret`.
function fbShapePositionsForShape(shape, barreFret) {
  const degreeLabels = fbShapeDegreeLabels(shape, '');
  const positions = [];
  shape.frets.forEach((v, i) => {
    if (v === 'x') return;
    positions.push({ stringIdx: i, fret: v + barreFret, degree: degreeLabels[i] });
  });
  return positions;
}

function fbShapeDegreeSetup() {
  const enabled = FB_SHAPE_ORDER.filter((_, i) => fbState.shapeDegree.shapes[i]);
  const pool = enabled.length ? enabled : FB_SHAPE_ORDER;
  const shapeLetter = pool[Math.floor(Math.random() * pool.length)];
  const rootPc = Math.floor(Math.random() * 12);
  const shape = FB_CAGED_SHAPES[shapeLetter];
  const barreFret = fbBarreFretForShape(rootPc, shape);
  return { shapeLetter, rootPc, shape, barreFret, positions: fbShapePositionsForShape(shape, barreFret) };
}

function fbRenderShapeDegreeOptions() {
  document.getElementById('fb-shapedeg-options').innerHTML = `
    <span>Shapes:</span>
    ${FB_SHAPE_ORDER.map((letter, i) => `
      <label><input type="checkbox" data-shapedeg="${i}" ${fbState.shapeDegree.shapes[i] ? 'checked' : ''}
        onchange="fbToggleShapeDegreeShape(${i})"> ${i + 1} (${letter})</label>
    `).join('')}
  `;
}

function fbToggleShapeDegreeShape(i) {
  const s = fbState.shapeDegree.shapes;
  s[i] = !s[i];
  if (!s.some(Boolean)) s[i] = true; // keep at least one selected
  fbPrefsSave();
  fbRenderShapeDegreeOptions();
  // Both submodes' panels exist in the DOM at once (only one is visible), so
  // both need a fresh question now — otherwise switching to the hidden one
  // shows a stale question drawn from the old (unfiltered) shape pool.
  fbShapeDegreeIdentifyNext();
  fbShapeDegreeLocateNext();
}

// Renders the shape's fretted positions on the shared linear fretboard SVG.
// opts.highlightIdx marks one position in the "quiz" color (Identify mode);
// opts.clickable + opts.onClick wires click handlers on every position
// (Locate mode); opts.revealAll prints each position's degree as text
// (shown after answering, in either mode, for reinforcement).
function fbRenderShapeDegreeBoard(containerEl, positions, opts = {}) {
  const frets = positions.map(p => p.fret);
  const startFret = Math.max(0, Math.min(...frets) - 1);
  const numFrets = Math.max(5, Math.max(...frets) - startFret + 1);
  const b = fbBuildBoard(numFrets, startFret);

  positions.forEach((p, idx) => {
    const cx = fbMarkerX(b, p.fret - startFret);
    const cy = b.yString(p.stringIdx);
    const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circ.setAttribute('cx', cx); circ.setAttribute('cy', cy); circ.setAttribute('r', 11);
    circ.setAttribute('class', opts.highlightIdx === idx ? 'fb-quiz-dot' : 'fb-shape-dot');
    b.svg.appendChild(circ);
    if (opts.clickable) {
      circ.classList.add('clickable');
      circ.addEventListener('click', () => opts.onClick(p, circ));
    }
    if (opts.revealAll) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', cx); t.setAttribute('y', cy + 4);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'fb-shape-degree-label');
      t.textContent = p.degree;
      b.svg.appendChild(t);
    }
  });

  containerEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board';
  wrap.appendChild(b.svg);
  containerEl.appendChild(wrap);
}

function fbShapeDegreeSetMode(mode) {
  fbState.shapeDegree.mode = mode;
  fbPrefsSave();
  document.querySelectorAll('#fb-shapedeg-mode-tabs .fb-subtab').forEach(b => b.classList.toggle('active', b.dataset.degreemode === mode));
  document.getElementById('fb-shapedeg-identify-panel').style.display = mode === 'identify' ? '' : 'none';
  document.getElementById('fb-shapedeg-locate-panel').style.display = mode === 'locate' ? '' : 'none';
}

function fbRenderShapeDegreeStats(subMode) {
  const s = fbState.shapeDegree[subMode];
  document.getElementById(`fb-shapedeg-${subMode}-stats`).innerHTML = `
    <span class="fb-stat-ok">Correct <b>${s.correct}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbShapeDegreeIdentifyNext() {
  const s = fbState.shapeDegree.identify;
  s.locked = false;
  const setup = fbShapeDegreeSetup();
  const targetIdx = Math.floor(Math.random() * setup.positions.length);
  s.current = { ...setup, targetIdx };

  fbRenderShapeDegreeStats('identify');
  document.getElementById('fb-shapedeg-identify-prompt').innerHTML =
    `Root <b>${FB_NOTE_NAMES[setup.rootPc]}</b>, <b>${setup.shapeLetter}-shape</b> (barred at fret ${setup.barreFret}). What scale degree is the highlighted position?`;
  fbRenderShapeDegreeBoard(document.getElementById('fb-shapedeg-identify-board'), setup.positions, { highlightIdx: targetIdx });
  document.getElementById('fb-shapedeg-identify-answers').innerHTML =
    ['1', '3', '5'].map(d => `<button class="fb-answer-btn" onclick="fbShapeDegreeIdentifyAnswer('${d}', this)">${d}</button>`).join('');
  const fb = document.getElementById('fb-shapedeg-identify-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
}

function fbShapeDegreeIdentifyAnswer(degree, btnEl) {
  const s = fbState.shapeDegree.identify;
  if (s.locked) return;
  s.locked = true;
  s.total++;
  const target = s.current.positions[s.current.targetIdx];
  const correct = degree === target.degree;
  if (correct) { s.correct++; s.streak++; } else { s.streak = 0; }
  btnEl.classList.add(correct ? 'correct' : 'wrong');

  const fb = document.getElementById('fb-shapedeg-identify-feedback');
  fb.textContent = correct ? `Correct — ${target.degree}` : `${target.degree} (you said ${degree})`;
  fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
  fbRenderShapeDegreeStats('identify');
  fbRenderShapeDegreeBoard(document.getElementById('fb-shapedeg-identify-board'), s.current.positions, { highlightIdx: s.current.targetIdx, revealAll: true });
  setTimeout(fbShapeDegreeIdentifyNext, 1100);
}

function fbShapeDegreeLocateNext() {
  const s = fbState.shapeDegree.locate;
  s.answered = false;
  const setup = fbShapeDegreeSetup();
  const degreesAvailable = [...new Set(setup.positions.map(p => p.degree))];
  const targetDegree = degreesAvailable[Math.floor(Math.random() * degreesAvailable.length)];
  s.current = { ...setup, targetDegree };

  fbRenderShapeDegreeStats('locate');
  document.getElementById('fb-shapedeg-locate-prompt').innerHTML =
    `Root <b>${FB_NOTE_NAMES[setup.rootPc]}</b>, <b>${setup.shapeLetter}-shape</b> (barred at fret ${setup.barreFret}). Click a position that is the <b>${targetDegree}</b>.`;
  fbRenderShapeDegreeBoard(document.getElementById('fb-shapedeg-locate-board'), setup.positions, {
    clickable: true,
    onClick: (pos, circleEl) => fbShapeDegreeLocateAnswer(pos, circleEl),
  });
  const fb = document.getElementById('fb-shapedeg-locate-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
}

function fbShapeDegreeLocateAnswer(pos, circleEl) {
  const s = fbState.shapeDegree.locate;
  if (s.answered) return;
  s.answered = true;
  s.total++;
  const correct = pos.degree === s.current.targetDegree;
  if (correct) { s.correct++; s.streak++; } else { s.streak = 0; }
  circleEl.classList.add(correct ? 'correct' : 'wrong');

  const fb = document.getElementById('fb-shapedeg-locate-feedback');
  fb.textContent = correct ? `Correct — that's the ${pos.degree}` : `That's the ${pos.degree}, not the ${s.current.targetDegree}`;
  fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
  fbRenderShapeDegreeStats('locate');
  fbRenderShapeDegreeBoard(document.getElementById('fb-shapedeg-locate-board'), s.current.positions, { revealAll: true });
  setTimeout(fbShapeDegreeLocateNext, 1100);
}

// ── Ear Training drill ──
// Interval recognition within a pentatonic/blues scale: the app plays 2 (or
// 3) notes drawn from the scale and asks which interval spans them. Every
// interval that can occur between any two scale tones is included as an
// answer choice — deriving that set from the scale itself (rather than a
// fixed list) is what makes adding a new scale (blues, or later modes) just
// a matter of adding a degrees array, no other code changes.

const FB_INTERVAL_NAMES = ['Unison', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];

// Degrees are semitone offsets from the root, spanning one octave (the last
// entry is always the root an octave up, included so intervals that cross
// the octave boundary — e.g. b7 to the next root — are reachable too).
const FB_EAR_SCALES = {
  minor: { label: 'Minor Pentatonic', degrees: [0, 3, 5, 7, 10, 12], labels: ['1', 'b3', '4', '5', 'b7', '1\''] },
  blues: { label: 'Blues Scale', degrees: [0, 3, 5, 6, 7, 10, 12], labels: ['1', 'b3', '4', 'b5', '5', 'b7', '1\''] },
  major: { label: 'Major (Ionian)', degrees: [0, 2, 4, 5, 7, 9, 11, 12], labels: ['1', '2', '3', '4', '5', '6', '7', '1\''] },
  naturalMinor: { label: 'Natural Minor (Aeolian)', degrees: [0, 2, 3, 5, 7, 8, 10, 12], labels: ['1', '2', 'b3', '4', '5', 'b6', 'b7', '1\''] },
  harmonicMinor: { label: 'Harmonic Minor', degrees: [0, 2, 3, 5, 7, 8, 11, 12], labels: ['1', '2', 'b3', '4', '5', 'b6', '7', '1\''] },
};

// Classic "anchor song" mnemonics — the standard ear-training trick for
// intervals that are hard to place by raw size alone (fine for m2/m3/M3,
// much harder for P4 upward): recognizing the opening of a song you already
// know by heart is faster than judging distance in the abstract.
const FB_EAR_INTERVAL_HINTS = {
  m2: "Jaws theme",
  M2: "Happy Birthday (1st-2nd note)",
  m3: "Greensleeves (opening)",
  M3: "Kumbaya (1st-2nd note)",
  P4: "Here Comes the Bride / Auld Lang Syne",
  TT: "The Simpsons theme (opening)",
  P5: "Twinkle Twinkle Little Star / Star Wars theme",
  m6: "The Entertainer (opening) / Love Story theme",
  M6: "My Bonnie Lies Over the Ocean / NBC chimes",
  m7: "Star Trek (original series) theme",
  M7: "Take On Me (chorus leap)",
  P8: "Somewhere Over the Rainbow (opening)",
};

// Three registers to play notes in, so questions aren't always centered on
// the same octave — 'low' sits in typical guitar low-string range, 'mid' is
// the original default (roughly middle C ± an octave), 'high' shifts up an
// octave from that.
const FB_EAR_RANGE_BASE = { low: 36, mid: 48, high: 60 };
const FB_EAR_RANGE_LABELS = { low: 'Low (C2-B3ish)', mid: 'Mid (C3-B4ish, default)', high: 'High (C4-B5ish)' };

function fbEarIntervalName(semitones) {
  return FB_INTERVAL_NAMES[semitones];
}

// Every distinct interval (by semitone count) formed between any two of the
// scale's degrees, sorted small to large and named — this is exactly the
// answer-choice set for that scale.
function fbEarPossibleIntervals(degrees) {
  const semitones = new Set();
  for (let i = 0; i < degrees.length; i++) {
    for (let j = i + 1; j < degrees.length; j++) {
      semitones.add(degrees[j] - degrees[i]);
    }
  }
  return [...semitones].sort((a, b) => a - b).map(fbEarIntervalName);
}

// The two adjacent intervals actually heard in a 3-note question, in the
// order they're played — order is 3 scale-degree indices (e.g. [i, mid, j]
// ascending or [j, mid, i] descending); the interval between notes 1-2 and
// notes 2-3 is what's asked, regardless of which direction it's played.
function fbEarAdjacentIntervals(degrees, order) {
  return [
    Math.abs(degrees[order[1]] - degrees[order[0]]),
    Math.abs(degrees[order[2]] - degrees[order[1]]),
  ];
}

// Lazily created on first Play click (browsers require a user gesture before
// audio can start) and reused for every question after that.
let fbEarAudioCtx = null;
function fbEarGetAudioCtx() {
  if (!fbEarAudioCtx) {
    fbEarAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    fbRegisterAudioContext(fbEarAudioCtx);
  }
  if (fbEarAudioCtx.state === 'suspended') fbEarAudioCtx.resume();
  return fbEarAudioCtx;
}

// Plays a sequence of MIDI notes according to fbState.ear.playbackStyle:
// 'melodic' (one after another, the default), 'harmonic' (all at once, like
// a chord), or 'both' (melodic run, then the same notes stacked together).
// Returns the total playback duration in ms so callers can debounce repeat
// clicks for exactly as long as the audio is actually playing.
function fbEarPlaySequence(midiNotes) {
  const ctx = fbEarGetAudioCtx();
  const noteDur = 0.9;
  const gap = fbState.ear.noteGapSec;
  const style = fbState.ear.playbackStyle;
  const start = ctx.currentTime + 0.05;

  const playOne = (midi, atTime) => {
    const osc = ctx.createOscillator();
    osc.type = fbState.ear.waveform;
    osc.frequency.value = fbFreqFromMidi(midi);
    // Square/sawtooth are harmonic-rich enough to sound harsh at full volume —
    // a gentle lowpass rounds off the edge without changing the waveform choice.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, atTime);
    gain.gain.linearRampToValueAtTime(0.3, atTime + 0.015);
    gain.gain.setValueAtTime(0.3, atTime + noteDur - 0.05);
    gain.gain.linearRampToValueAtTime(0, atTime + noteDur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(atTime);
    osc.stop(atTime + noteDur + 0.02);
  };

  let melodicEnd = start;
  if (style !== 'harmonic') {
    let t = start;
    midiNotes.forEach((midi, idx) => {
      playOne(midi, t);
      melodicEnd = t + noteDur;
      if (idx < midiNotes.length - 1) t += noteDur + gap;
    });
  }

  let totalEnd = melodicEnd;
  if (style === 'harmonic') {
    midiNotes.forEach(midi => playOne(midi, start));
    totalEnd = start + noteDur;
  } else if (style === 'both') {
    const chordStart = melodicEnd + 0.2;
    midiNotes.forEach(midi => playOne(midi, chordStart));
    totalEnd = chordStart + noteDur;
  }

  return Math.ceil((totalEnd - start) * 1000) + 150;
}

// Debounces repeat clicks (Play button, or clicking dots on the diagram) so
// a fast double-click can't overlap two copies of the same audio.
function fbEarPlayNotesFor(subMode, midiNotes) {
  const s = fbState.ear[subMode];
  const now = Date.now();
  if (s.playingUntil && now < s.playingUntil) return;
  s.playingUntil = now + fbEarPlaySequence(midiNotes);
}

function fbEarPlayCurrent(subMode) {
  fbEarPlayNotesFor(subMode, fbState.ear[subMode].current.notes);
}

// "Fill the gap": for a hard-to-place interval (e.g. a 6th or 7th), plays
// every scale step from the lower quiz note up to the higher one — not just
// the two endpoints — so it's heard as a short scale walk instead of one
// blind jump. Ascending regardless of which direction the quiz itself played.
function fbEarPlayScaffold(subMode) {
  const c = fbState.ear[subMode].current;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  const notes = [];
  for (let idx = c.i; idx <= c.j; idx++) notes.push(c.rootMidi + degrees[idx]);
  fbEarPlayNotesFor(subMode, notes);
}

// Shared markup for the output-device picker — dropped into every options
// panel that has an input-device picker too (see fbOutput above).
function fbOutputDeviceSelectHtml() {
  return `
    <label>Output device:
      <select class="fb-output-select" onchange="fbOutputDeviceChange(this.value)"><option value="">Default (grant mic access first)</option></select>
    </label>
    ${FB_SETSINKID_SUPPORTED ? '' : '<span style="color:#888">(this browser can only play through the system default output)</span>'}
  `;
}

function fbRenderEarOptions() {
  document.getElementById('fb-ear-options').innerHTML = `
    <label>Scale:
      <select onchange="fbEarSetScale(this.value)">
        ${Object.entries(FB_EAR_SCALES).map(([key, s]) =>
          `<option value="${key}" ${fbState.ear.scale === key ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>
    </label>
    <label>Tone:
      <select onchange="fbState.ear.waveform=this.value; fbPrefsSave()">
        <option value="sine" ${fbState.ear.waveform === 'sine' ? 'selected' : ''}>Sine (soft)</option>
        <option value="triangle" ${fbState.ear.waveform === 'triangle' ? 'selected' : ''}>Triangle</option>
        <option value="square" ${fbState.ear.waveform === 'square' ? 'selected' : ''}>Square</option>
        <option value="sawtooth" ${fbState.ear.waveform === 'sawtooth' ? 'selected' : ''}>Sawtooth</option>
      </select>
    </label>
    <label>Playback:
      <select onchange="fbState.ear.playbackStyle=this.value; fbPrefsSave()">
        <option value="melodic" ${fbState.ear.playbackStyle === 'melodic' ? 'selected' : ''}>Melodic (one after another)</option>
        <option value="harmonic" ${fbState.ear.playbackStyle === 'harmonic' ? 'selected' : ''}>Harmonic (all together)</option>
        <option value="both" ${fbState.ear.playbackStyle === 'both' ? 'selected' : ''}>Both (melodic, then together)</option>
      </select>
    </label>
    <label>Note gap:
      <input type="number" min="0" max="2" step="0.05" value="${fbState.ear.noteGapSec}" style="width:56px"
        onchange="fbState.ear.noteGapSec=Math.max(0, parseFloat(this.value)||0); fbPrefsSave()"> sec</label>
    <label>Direction:
      <select onchange="fbState.ear.direction=this.value; fbPrefsSave()">
        <option value="both" ${fbState.ear.direction === 'both' ? 'selected' : ''}>Both (random)</option>
        <option value="asc" ${fbState.ear.direction === 'asc' ? 'selected' : ''}>Ascending only</option>
        <option value="desc" ${fbState.ear.direction === 'desc' ? 'selected' : ''}>Descending only</option>
      </select>
    </label>
    <label>Range:
      <select onchange="fbState.ear.range=this.value; fbPrefsSave()">
        ${Object.keys(FB_EAR_RANGE_BASE).map(k => `<option value="${k}" ${fbState.ear.range === k ? 'selected' : ''}>${FB_EAR_RANGE_LABELS[k]}</option>`).join('')}
      </select>
    </label>
    <label><input type="checkbox" ${fbState.ear.autoAdvance ? 'checked' : ''}
      onchange="fbEarSetAutoAdvance(this.checked)"> Auto-advance</label>
    <label>Pause after wrong answer:
      <input type="number" min="0.5" max="15" step="0.5" value="${fbState.ear.wrongPauseSec}" style="width:56px"
        onchange="fbState.ear.wrongPauseSec=parseFloat(this.value)||3; fbPrefsSave()"> sec</label>
    <label><input type="checkbox" ${fbState.ear.showDiagram ? 'checked' : ''}
      onchange="fbState.ear.showDiagram=this.checked; fbPrefsSave(); fbEarRefreshDiagrams()"> Show scale diagram</label>
  `;
}

// Notes laid out on an axis where 1 semitone = 1 unit of width, so interval
// sizes are visually honest (a whole tone really does look twice as wide as
// a half tone) — labels the gap between each pair of *adjacent* scale
// degrees by default. `current` (when given) draws one accent arc per entry
// in current.arcs (the interval(s) actually being tested, revealed after
// answering) and highlights current.dots. Every dot is always clickable,
// independent of any active question: click two dots to hear that pair
// played and see its interval drawn as a second "explore" arc.
function fbRenderEarScaleDiagram(containerEl, scaleKey, current, subMode) {
  const { degrees, labels } = FB_EAR_SCALES[scaleKey];
  const s = fbState.ear[subMode];
  const UNIT = 34, PAD_L = 24, PAD_R = 24;
  const width = PAD_L + 12 * UNIT + PAD_R;
  const height = 140;
  const baseY = 70;
  const x = semi => PAD_L + semi * UNIT;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const line = (x1, y1, x2, y2, cls) => {
    const el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('class', cls);
    svg.appendChild(el);
  };
  const text = (tx, ty, str, cls) => {
    const el = document.createElementNS(ns, 'text');
    el.setAttribute('x', tx); el.setAttribute('y', ty);
    el.setAttribute('class', cls);
    el.setAttribute('text-anchor', 'middle');
    el.textContent = str;
    svg.appendChild(el);
  };
  const circle = (cx, cy, r, cls) => {
    const el = document.createElementNS(ns, 'circle');
    el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    el.setAttribute('class', cls);
    svg.appendChild(el);
    return el;
  };
  const arc = (i, j, y, lineCls, labelCls) => {
    const xa = x(degrees[i]), xb = x(degrees[j]);
    line(xa, y, xb, y, lineCls);
    line(xa, y - 5, xa, y + 5, lineCls);
    line(xb, y - 5, xb, y + 5, lineCls);
    text((xa + xb) / 2, y - 8, fbEarIntervalName(degrees[j] - degrees[i]), labelCls);
  };

  line(x(0), baseY, x(12), baseY, 'fb-ear-tick-minor');
  for (let semi = 0; semi <= 12; semi++) {
    const onScale = degrees.includes(semi);
    line(x(semi), baseY - (onScale ? 10 : 5), x(semi), baseY + (onScale ? 10 : 5), onScale ? 'fb-ear-tick-major' : 'fb-ear-tick-minor');
  }

  for (let k = 0; k < degrees.length - 1; k++) {
    const xa = x(degrees[k]), xb = x(degrees[k + 1]), y = baseY + 22;
    line(xa, y, xb, y, 'fb-ear-adj-line');
    line(xa, y - 4, xa, y + 4, 'fb-ear-adj-line');
    line(xb, y - 4, xb, y + 4, 'fb-ear-adj-line');
    text((xa + xb) / 2, y + 14, fbEarIntervalName(degrees[k + 1] - degrees[k]), 'fb-ear-adj-label');
  }

  degrees.forEach((semi, idx) => {
    let cls = 'fb-ear-dot';
    if (current && current.dots && current.dots.includes(idx)) cls += ' highlight';
    if (s.exploreFirstIdx === idx) cls += ' armed';
    const dot = circle(x(semi), baseY, 9, cls);
    dot.addEventListener('click', () => fbEarDotClicked(subMode, idx));
    text(x(semi), baseY - 16, labels[idx], 'fb-ear-dot-label');
  });

  if (current && current.arcs) {
    current.arcs.forEach(({ i, j }) => arc(i, j, baseY - 26, 'fb-ear-highlight-line', 'fb-ear-highlight-label'));
  }
  if (s.exploreArc) {
    arc(s.exploreArc.i, s.exploreArc.j, baseY - 42, 'fb-ear-explore-line', 'fb-ear-explore-label');
  }

  containerEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board fb-ear-diagram';
  wrap.appendChild(svg);
  containerEl.appendChild(wrap);
}

// Click-to-explore: first click arms a note (waiting for a second pick),
// second click plays that pair (in the order clicked — direction doesn't
// change the interval) and draws it as a blue arc. Purely exploratory, not
// part of question scoring, and works whether or not a question has been
// answered yet.
function fbEarDotClicked(subMode, idx) {
  const s = fbState.ear[subMode];
  if (s.exploreFirstIdx === null) {
    s.exploreFirstIdx = idx;
    fbEarRenderDiagramFor(subMode);
    return;
  }
  const first = s.exploreFirstIdx;
  s.exploreFirstIdx = null;
  if (first === idx) { fbEarRenderDiagramFor(subMode); return; }
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  fbEarPlayNotesFor(subMode, [first, idx].map(i => s.current.rootMidi + degrees[i]));
  s.exploreArc = { i: Math.min(first, idx), j: Math.max(first, idx) };
  fbEarRenderDiagramFor(subMode);
}

function fbEarRenderDiagramFor(subMode, current) {
  const s = fbState.ear[subMode];
  if (current !== undefined) s.diagramCurrent = current;
  const el = document.getElementById(`fb-ear-${subMode}-diagram`);
  if (!fbState.ear.showDiagram) { el.innerHTML = ''; return; }
  fbRenderEarScaleDiagram(el, fbState.ear.scale, s.diagramCurrent, subMode);
}

function fbEarRefreshDiagrams() {
  fbEarRenderDiagramFor('two');
  fbEarRenderDiagramFor('three');
}

function fbEarSetScale(scale) {
  fbState.ear.scale = scale;
  fbPrefsSave();
  // Both submode panels exist in the DOM at once — see the identical note on
  // fbToggleShapeDegreeShape — so both need a fresh question now.
  fbEarTwoNext();
  fbEarThreeNext();
}

function fbEarSetMode(mode) {
  fbState.ear.mode = mode;
  fbPrefsSave();
  document.querySelectorAll('#fb-ear-mode-tabs .fb-subtab').forEach(b => b.classList.toggle('active', b.dataset.earmode === mode));
  document.getElementById('fb-ear-two-panel').style.display = mode === 'two' ? '' : 'none';
  document.getElementById('fb-ear-three-panel').style.display = mode === 'three' ? '' : 'none';
}

function fbRenderEarStats(subMode) {
  const s = fbState.ear[subMode];
  document.getElementById(`fb-ear-${subMode}-stats`).innerHTML = `
    <span class="fb-stat-ok">Correct <b>${s.correct}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

// Cancels any pending auto-advance timer for a submode — needed whenever a
// fresh question is generated some other way (manual Next, changing the
// scale) so the old timer doesn't also fire later and skip a question.
function fbEarClearTimeout(subMode) {
  const s = fbState.ear[subMode];
  if (s.timeoutId) { clearTimeout(s.timeoutId); s.timeoutId = null; }
}

function fbEarSetAutoAdvance(checked) {
  fbState.ear.autoAdvance = checked;
  fbPrefsSave();
  // A timer scheduled before this toggle flipped off would otherwise still
  // fire later and silently skip whatever question the player is looking at.
  if (!checked) { fbEarClearTimeout('two'); fbEarClearTimeout('three'); }
}

function fbEarManualNext(subMode) {
  fbEarClearTimeout(subMode);
  if (subMode === 'two') fbEarTwoNext(); else fbEarThreeNext();
  fbEarPlayCurrent(subMode);
}

// fbState.ear.direction controls whether questions play low-to-high,
// high-to-low, or (default) a random mix of both every time.
function fbEarPickOrder(ascOrder, descOrder) {
  const dir = fbState.ear.direction;
  if (dir === 'asc') return ascOrder;
  if (dir === 'desc') return descOrder;
  return Math.random() < 0.5 ? descOrder : ascOrder;
}

function fbEarTwoNext() {
  const s = fbState.ear.two;
  fbEarClearTimeout('two');
  s.answered = false;
  s.exploreFirstIdx = null;
  s.exploreArc = null;
  s.playingUntil = 0;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  let i = Math.floor(Math.random() * degrees.length);
  let j = Math.floor(Math.random() * degrees.length);
  while (j === i) j = Math.floor(Math.random() * degrees.length);
  if (i > j) [i, j] = [j, i];
  const rootMidi = FB_EAR_RANGE_BASE[fbState.ear.range] + Math.floor(Math.random() * 12);
  // i/j stay low-to-high (for the diagram and interval math); `order` is the
  // actual playback/reveal direction, which is independent — an interval
  // sounds the same size whether it's played ascending or descending.
  const order = fbEarPickOrder([i, j], [j, i]);
  s.current = { i, j, order, rootMidi, notes: order.map(idx => rootMidi + degrees[idx]), interval: degrees[j] - degrees[i] };

  fbRenderEarStats('two');
  document.getElementById('fb-ear-two-prompt').textContent = 'Listen — what interval spans the two notes?';
  document.getElementById('fb-ear-two-answers').innerHTML =
    fbEarPossibleIntervals(degrees).map(name => `<button class="fb-answer-btn" onclick="fbEarTwoAnswer('${name}', this)">${name}</button>`).join('');
  const fb = document.getElementById('fb-ear-two-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
  fbEarRenderDiagramFor('two', null);
}

function fbEarTwoAnswer(name, btnEl) {
  const s = fbState.ear.two;
  if (s.answered) return;
  s.answered = true;
  s.total++;
  const target = fbEarIntervalName(s.current.interval);
  const correct = name === target;
  if (correct) { s.correct++; s.streak++; } else { s.streak = 0; }
  btnEl.classList.add(correct ? 'correct' : 'wrong');

  const labels = FB_EAR_SCALES[fbState.ear.scale].labels;
  const noteDesc = s.current.order.map(idx => labels[idx]).join(' → ');
  const hint = FB_EAR_INTERVAL_HINTS[target] ? ` — like "${FB_EAR_INTERVAL_HINTS[target]}"` : '';
  const fb = document.getElementById('fb-ear-two-feedback');
  fb.textContent = correct ? `Correct — ${target} (${noteDesc})${hint}` : `${target} (${noteDesc}) — you said ${name}${hint}`;
  fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
  fbRenderEarStats('two');
  fbEarRenderDiagramFor('two', { dots: [s.current.i, s.current.j], arcs: [{ i: s.current.i, j: s.current.j }] });
  if (fbState.ear.autoAdvance) {
    s.timeoutId = setTimeout(fbEarTwoNext, correct ? 900 : fbState.ear.wrongPauseSec * 1000);
  }
}

// 3-note drill: asks the two *adjacent* intervals (1st-2nd, 2nd-3rd) rather
// than the outer 1st-3rd span, so the middle note is a real quiz target
// instead of just a passing tone — one question, answered in two steps.
function fbEarThreeNext() {
  const s = fbState.ear.three;
  fbEarClearTimeout('three');
  s.answered = false;
  s.step = 1;
  s.step1Correct = null;
  s.exploreFirstIdx = null;
  s.exploreArc = null;
  s.playingUntil = 0;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  let idxs;
  do {
    idxs = [Math.floor(Math.random() * degrees.length), Math.floor(Math.random() * degrees.length), Math.floor(Math.random() * degrees.length)];
  } while (new Set(idxs).size < 3);
  idxs.sort((a, b) => a - b);
  const [i, mid, j] = idxs;
  const rootMidi = FB_EAR_RANGE_BASE[fbState.ear.range] + Math.floor(Math.random() * 12);
  const order = fbEarPickOrder([i, mid, j], [j, mid, i]);
  const [interval1, interval2] = fbEarAdjacentIntervals(degrees, order);
  s.current = { i, mid, j, order, rootMidi, interval1, interval2, notes: order.map(idx => rootMidi + degrees[idx]) };

  fbRenderEarStats('three');
  fbEarRenderThreeStep();
  fbEarRenderDiagramFor('three', null);
}

function fbEarRenderThreeStep() {
  const s = fbState.ear.three;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  const stepLabel = s.step === 1 ? '1st and 2nd' : '2nd and 3rd';
  document.getElementById('fb-ear-three-prompt').textContent = `Listen — what interval spans the ${stepLabel} notes?`;
  document.getElementById('fb-ear-three-answers').innerHTML =
    fbEarPossibleIntervals(degrees).map(name => `<button class="fb-answer-btn" onclick="fbEarThreeAnswer('${name}', this)">${name}</button>`).join('');
  const fb = document.getElementById('fb-ear-three-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
}

function fbEarThreeAnswer(name, btnEl) {
  const s = fbState.ear.three;
  if (s.answered) return;
  const target = s.step === 1 ? s.current.interval1 : s.current.interval2;
  const correct = name === fbEarIntervalName(target);
  btnEl.classList.add(correct ? 'correct' : 'wrong');

  if (s.step === 1) {
    s.step1Correct = correct;
    const targetName = fbEarIntervalName(target);
    const hint1 = FB_EAR_INTERVAL_HINTS[targetName] ? ` — like "${FB_EAR_INTERVAL_HINTS[targetName]}"` : '';
    const fb = document.getElementById('fb-ear-three-feedback');
    fb.textContent = correct ? `Correct — ${targetName}${hint1}` : `${targetName} — you said ${name}${hint1}`;
    fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
    setTimeout(() => { s.step = 2; fbEarRenderThreeStep(); }, 900);
    return;
  }

  s.answered = true;
  s.total++;
  const overallCorrect = s.step1Correct && correct;
  if (overallCorrect) { s.correct++; s.streak++; } else { s.streak = 0; }

  const labels = FB_EAR_SCALES[fbState.ear.scale].labels;
  const noteDesc = s.current.order.map(idx => labels[idx]).join(' → ');
  const int1 = fbEarIntervalName(s.current.interval1), int2 = fbEarIntervalName(s.current.interval2);
  const hint2 = FB_EAR_INTERVAL_HINTS[int2] ? ` — like "${FB_EAR_INTERVAL_HINTS[int2]}"` : '';
  const fb = document.getElementById('fb-ear-three-feedback');
  fb.textContent = overallCorrect
    ? `Correct — ${int1} then ${int2} (${noteDesc})${hint2}`
    : `${int1} then ${int2} (${noteDesc}) — you said ${name}${hint2}`;
  fb.className = 'fb-feedback ' + (overallCorrect ? 'ok' : 'err');
  fbRenderEarStats('three');
  fbEarRenderDiagramFor('three', {
    dots: [s.current.i, s.current.mid, s.current.j],
    arcs: [{ i: s.current.i, j: s.current.mid }, { i: s.current.mid, j: s.current.j }],
  });
  if (fbState.ear.autoAdvance) {
    s.timeoutId = setTimeout(fbEarThreeNext, overallCorrect ? 900 : fbState.ear.wrongPauseSec * 1000);
  }
}

// ── Shared mic manager (used by both Pitch Match and Tuner) ──

const fbMic = {
  stream: null, audioCtx: null, analyser: null, rafId: null,
  deviceId: '', userSelectedDevice: false, listening: false, onFrame: null, owner: null,
};

// ── Shared output-device selection (which speaker/interface plays back any
// audio the app generates — Ear Training and Speed Trainer's metronome so
// far, each with its own AudioContext) ──
// AudioContext.setSinkId() is a newer, Chromium-only API; everywhere else this
// silently no-ops and audio just keeps playing through the system default.
const FB_SETSINKID_SUPPORTED = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
const fbOutput = { deviceId: '', userSelectedDevice: false };
// Every AudioContext any feature creates registers itself here, so a single
// output-device change applies to all of them at once instead of just
// whichever one happened to exist when fbOutputDeviceChange last ran.
const fbRegisteredAudioContexts = new Set();

function fbRegisterAudioContext(ctx) {
  fbRegisteredAudioContexts.add(ctx);
  fbApplySinkId(ctx);
}

async function fbApplySinkId(ctx) {
  if (!ctx || !FB_SETSINKID_SUPPORTED || !fbOutput.deviceId) return;
  try { await ctx.setSinkId(fbOutput.deviceId); } catch (_) { /* device gone, or not permitted */ }
}

function fbApplySinkIdToAll() {
  fbRegisteredAudioContexts.forEach(fbApplySinkId);
}

// Output device labels only become readable after mic permission has been
// granted somewhere in the app (same browser rule as input labels) — called
// after that happens, and whenever an options panel with an output selector renders.
async function fbRefreshOutputDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter(d => d.kind === 'audiooutput');
    if (!outputs.length) return;
    if (!fbOutput.userSelectedDevice) {
      const preferred = outputs.find(d => /scarlett|focusrite/i.test(d.label));
      if (preferred && preferred.deviceId !== fbOutput.deviceId) {
        fbOutput.deviceId = preferred.deviceId;
        fbApplySinkIdToAll();
      }
    }
    document.querySelectorAll('.fb-output-select').forEach(sel => {
      sel.innerHTML = outputs.map(d =>
        `<option value="${d.deviceId}" ${d.deviceId === fbOutput.deviceId ? 'selected' : ''}>${d.label || 'Speaker'}</option>`
      ).join('');
    });
  } catch (_) { /* enumeration not available */ }
}

async function fbOutputDeviceChange(deviceId) {
  fbOutput.userSelectedDevice = true;
  fbOutput.deviceId = deviceId;
  document.querySelectorAll('.fb-output-select').forEach(sel => { sel.value = deviceId; });
  fbApplySinkIdToAll();
}

async function fbMicStart(owner, onFrame, fftSize = 2048) {
  if (fbMic.listening) fbMicStop();
  const constraints = { audio: fbMic.deviceId ? { deviceId: { exact: fbMic.deviceId } } : true };
  fbMic.stream = await navigator.mediaDevices.getUserMedia(constraints); // throws if denied — caller handles it
  await fbMicAutoSelectAndRefreshDevices();
  fbMic.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  fbMic.analyser = fbMic.audioCtx.createAnalyser();
  fbMic.analyser.fftSize = fftSize;
  fbMic.analyser.smoothingTimeConstant = 0.3;
  fbMic.audioCtx.createMediaStreamSource(fbMic.stream).connect(fbMic.analyser);
  fbMic.onFrame = onFrame;
  fbMic.owner = owner;
  fbMic.listening = true;
  fbMicTick();
}

function fbMicStop() {
  if (fbMic.rafId) cancelAnimationFrame(fbMic.rafId);
  fbMic.rafId = null;
  if (fbMic.stream) fbMic.stream.getTracks().forEach(t => t.stop());
  if (fbMic.audioCtx) fbMic.audioCtx.close();
  fbMic.stream = null; fbMic.audioCtx = null; fbMic.analyser = null;
  fbMic.listening = false; fbMic.onFrame = null; fbMic.owner = null;
}

function fbMicTick() {
  if (!fbMic.listening) return;
  // each consumer pulls whatever it needs (time-domain for autocorrelation,
  // frequency-domain for chroma) — avoids paying for both on every frame
  if (fbMic.onFrame) fbMic.onFrame(fbMic.analyser, fbMic.audioCtx.sampleRate);
  fbMic.rafId = requestAnimationFrame(fbMicTick);
}

// After permission is granted, device labels become readable. Auto-pick an
// audio interface (Focusrite/Scarlett etc.) over the default mic unless the
// user has explicitly chosen a device themselves.
async function fbMicAutoSelectAndRefreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === 'audioinput');
    if (!inputs.length) return;
    if (!fbMic.userSelectedDevice) {
      const preferred = inputs.find(d => /scarlett|focusrite/i.test(d.label));
      if (preferred && preferred.deviceId !== fbMic.deviceId) {
        fbMic.deviceId = preferred.deviceId;
        if (fbMic.stream) fbMic.stream.getTracks().forEach(t => t.stop());
        fbMic.stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: preferred.deviceId } } });
      }
    }
    document.querySelectorAll('.fb-device-select').forEach(sel => {
      sel.innerHTML = inputs.map(d =>
        `<option value="${d.deviceId}" ${d.deviceId === fbMic.deviceId ? 'selected' : ''}>${d.label || 'Microphone'}</option>`
      ).join('');
    });
    // Granting mic permission is also what unlocks readable output-device
    // labels, so this is the natural point to refresh those too.
    await fbRefreshOutputDevices();
  } catch (_) { /* enumeration not available */ }
}

async function fbMicDeviceChange(deviceId) {
  fbMic.userSelectedDevice = true;
  fbMic.deviceId = deviceId;
  document.querySelectorAll('.fb-device-select').forEach(sel => { sel.value = deviceId; });
  if (fbMic.listening) {
    const owner = fbMic.owner, cb = fbMic.onFrame, fftSize = fbMic.analyser.fftSize;
    fbMicStop();
    try { await fbMicStart(owner, cb, fftSize); fbSyncMicButtons(owner); } catch (_) {}
  }
}

function fbSyncMicButtons(prefix) {
  const isOn = fbMic.listening && fbMic.owner === prefix;
  document.getElementById(`fb-${prefix}-start-btn`).style.display = isOn ? 'none' : '';
  document.getElementById(`fb-${prefix}-stop-btn`).style.display = isOn ? '' : 'none';
}

// ── Pitch Match drill (mic-based ear training) ──

const FB_MATCH_CENTS_TOLERANCE = 15;
const FB_MATCH_HOLD_FRAMES = 12;  // ~0.2s at 60fps — avoids false triggers on transients
const FB_WRONG_HOLD_FRAMES = 10;  // ~0.17s of a stable wrong note before we say something
const FB_WRONG_MSG_COOLDOWN_MS = 700;
const FB_METER_HOLD_MS = 1200; // how long a reading lingers after the note decays into silence
const FB_PITCH_STATS_KEY = 'fb_pitch_note_stats';

function fbRenderPitchMeter(r, held) {
  const meter = document.getElementById('fb-pitch-meter');
  meter.innerHTML = `
    <div class="fb-pitch-detected${r.isMatch ? ' match' : ''}${held ? ' held' : ''}">${r.noteName}<span class="fb-pitch-octave">${fbOctaveOf(r.midi)}</span></div>
    <div class="fb-pitch-cents-bar"><div class="fb-pitch-cents-needle" style="left:${50 + Math.max(-50, Math.min(50, r.cents))}%"></div></div>
    <div class="fb-pitch-hz">${r.freq.toFixed(1)} Hz &nbsp;·&nbsp; ${r.cents > 0 ? '+' : ''}${r.cents} cents</div>
  `;
}

// Tracks time the tab spends hidden (switched away) so it can be excluded
// from reaction-time measurements — otherwise tabbing away mid-question
// inflates that note's recorded "time to find it".
document.addEventListener('visibilitychange', () => {
  [fbState.pitch, fbState.chord].forEach(s => {
    if (document.hidden) {
      s._hiddenSince = performance.now();
    } else if (s._hiddenSince != null) {
      s._hiddenMs = (s._hiddenMs || 0) + (performance.now() - s._hiddenSince);
      s._hiddenSince = null;
    }
  });
});

function fbPitchLoadStats() {
  try { fbState.pitch.stats = JSON.parse(localStorage.getItem(FB_PITCH_STATS_KEY)) || {}; }
  catch (_) { fbState.pitch.stats = {}; }
}
function fbPitchSaveStats() {
  localStorage.setItem(FB_PITCH_STATS_KEY, JSON.stringify(fbState.pitch.stats));
}

function fbRenderPitchOptions() {
  const s = fbState.pitch;
  document.getElementById('fb-pitch-options').innerHTML = `
    <span>Strings:</span>
    ${FB_STRING_NAMES.map((n, i) => `
      <label><input type="checkbox" ${s.strings[i] ? 'checked' : ''} onchange="fbPitchToggleString(${i})"> ${n}${i===0?'(low)':i===5?'(high)':''}</label>
    `).join('')}
    <span style="margin-left:12px">Practice:</span>
    <select onchange="fbState.pitch.practiceMode=this.value; fbPrefsSave()">
      <option value="all" ${s.practiceMode==='all'?'selected':''}>All notes</option>
      <option value="weak" ${s.practiceMode==='weak'?'selected':''}>Focus on weak notes</option>
    </select>
    <label style="margin-left:12px"><input type="checkbox" ${s.showBoard ? 'checked' : ''}
      onchange="fbState.pitch.showBoard=this.checked; fbPrefsSave(); fbRenderPitchBoard()"> Show fretboard diagram</label>
    <button class="btn btn-ghost btn-sm" onclick="fbPitchResetStats()">Reset stats</button>
  `;
}

// Marks every position where the current target note occurs on the enabled
// strings (unlike the Note Names drill, which marks one specific spot — here
// the target is a note *name*, playable at several positions, so all of them
// light up). Off by default: most people practicing pitch matching by ear
// don't want the answer already drawn on the neck.
function fbRenderPitchBoard() {
  const s = fbState.pitch;
  const el = document.getElementById('fb-pitch-board');
  if (!el) return;
  if (!s.showBoard || !s.target) { el.innerHTML = ''; return; }

  const b = fbBuildBoard(12, 0);
  for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
    if (!s.strings[stringIdx]) continue;
    for (let fret = 0; fret <= 12; fret++) {
      if (fbNoteAt(stringIdx, fret) !== s.target) continue;
      const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circ.setAttribute('cx', fbMarkerX(b, fret));
      circ.setAttribute('cy', b.yString(stringIdx));
      circ.setAttribute('r', fret === 0 ? 10 : 11);
      circ.setAttribute('class', fret === 0 ? 'fb-open-marker' : 'fb-quiz-dot');
      b.svg.appendChild(circ);
    }
  }
  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board';
  wrap.appendChild(b.svg);
  el.appendChild(wrap);
}

function fbPitchToggleString(i) {
  const s = fbState.pitch;
  s.strings[i] = !s.strings[i];
  if (!s.strings.some(Boolean)) s.strings[i] = true; // keep at least one
  fbPrefsSave();
}

function fbPitchResetStats() {
  fbState.pitch.stats = {};
  fbPitchSaveStats();
  fbRenderPitchStatsTable();
}

// All open+fret(0..12) MIDI notes on one string.
function fbStringMidis(stringIdx) {
  const base = FB_STRING_OPEN_MIDI[stringIdx];
  const arr = [];
  for (let fret = 0; fret <= 12; fret++) arr.push(base + fret);
  return arr;
}

// Which absolute MIDI notes count as "correct" for a target note name, given
// the selected string filter. With all 6 strings selected (default) this
// spans several octaves — effectively unrestricted. Narrowing to one or two
// strings pins down which octave(s) are accepted, since we can't tell from
// audio alone which physical string was actually played (a given pitch can
// exist on several strings at once) — restricting strings instead restricts
// which octave is accepted as "found on that string".
function fbPitchAllowedMidis(noteName) {
  const s = fbState.pitch;
  const idx = FB_NOTE_NAMES.indexOf(noteName);
  const midis = new Set();
  for (let i = 0; i < 6; i++) {
    if (!s.strings[i]) continue;
    fbStringMidis(i).forEach(m => { if (((m % 12) + 12) % 12 === idx) midis.add(m); });
  }
  return midis;
}

function fbPitchPickTarget() {
  const s = fbState.pitch;
  if (s.practiceMode !== 'weak') return FB_NOTE_NAMES[Math.floor(Math.random() * 12)];
  const weights = FB_NOTE_NAMES.map(n => {
    const st = s.stats[n];
    if (!st || !st.presented) return 3; // unseen notes get decent priority too
    const acc = st.matched / st.presented;
    const avgMs = st.matched ? st.totalMs / st.matched : 4000;
    return Math.max(0.2, (1 - acc) * 4 + avgMs / 1500 + (st.wrongHits || 0) * 0.5);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < 12; i++) { r -= weights[i]; if (r <= 0) return FB_NOTE_NAMES[i]; }
  return FB_NOTE_NAMES[11];
}

function fbRenderPitchStats() {
  const s = fbState.pitch;
  document.getElementById('fb-pitch-stats').innerHTML = `
    <span class="fb-stat-ok">Matches <b>${s.matches}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbRenderPitchStatsTable() {
  const s = fbState.pitch;
  const el = document.getElementById('fb-pitch-stats-table');
  if (!el) return;
  const rows = FB_NOTE_NAMES.map(n => {
    const st = s.stats[n];
    const presented = st?.presented || 0;
    const matched = st?.matched || 0;
    const acc = presented ? Math.round((matched / presented) * 100) : null;
    const avg = matched ? (st.totalMs / matched / 1000).toFixed(1) : null;
    return { n, presented, acc, avg, wrong: st?.wrongHits || 0 };
  }).filter(r => r.presented > 0)
    .sort((a, b) => (a.acc ?? 999) - (b.acc ?? 999) || (b.avg ?? 0) - (a.avg ?? 0));
  if (!rows.length) {
    el.innerHTML = '<span style="color:#aaa;font-size:12px">No attempts yet — start listening and play some notes.</span>';
    return;
  }
  el.innerHTML = `
    <table class="fb-stats-table">
      <tr><th>Note</th><th>Tries</th><th>Accuracy</th><th>Avg time</th><th>Wrong hits</th></tr>
      ${rows.map(r => `<tr><td>${r.n}</td><td>${r.presented}</td><td>${r.acc}%</td><td>${r.avg ?? '—'}s</td><td>${r.wrong}</td></tr>`).join('')}
    </table>
  `;
}

function fbPitchNewNote() {
  const s = fbState.pitch;
  s.target = fbPitchPickTarget();
  s.matched = false;
  s._holdCount = 0;
  s._wrongNote = null;
  s._wrongHoldCount = 0;
  s._lastReading = null;
  s.startTime = performance.now();
  s._hiddenMs = 0;
  s._hiddenSince = document.hidden ? s.startTime : null;
  const st = s.stats[s.target] || (s.stats[s.target] = { presented: 0, matched: 0, totalMs: 0, wrongHits: 0 });
  st.presented++;
  fbPitchSaveStats();

  document.getElementById('fb-pitch-target').textContent = s.target;
  fbRenderPitchStats();
  fbRenderPitchStatsTable();
  fbRenderPitchBoard();
  const fb = document.getElementById('fb-pitch-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
}

async function fbPitchStart() {
  try {
    await fbMicStart('pitch', fbPitchOnFrame);
  } catch (e) {
    const fb = document.getElementById('fb-pitch-feedback');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('pitch');
}

function fbPitchStop() {
  fbMicStop();
  fbSyncMicButtons('pitch');
  document.getElementById('fb-pitch-meter').innerHTML = '';
}

function fbPitchOnFrame(analyser, sampleRate) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  const s = fbState.pitch;
  const meter = document.getElementById('fb-pitch-meter');
  const now = performance.now();

  if (!(freq > 0 && freq >= 60 && freq <= 1500)) {
    // A plucked string decays below the silence threshold well before you've
    // had time to read the meter — hold the last reading for a bit instead
    // of snapping straight back to "listening…".
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderPitchMeter(s._lastReading, true);
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">—</div><div class="fb-pitch-hz">listening…</div>`;
    }
    s._holdCount = 0;
    return;
  }

  const { noteName, cents, midi } = fbFreqToNote(freq);
  const allowed = fbPitchAllowedMidis(s.target);
  const isMatch = noteName === s.target && allowed.has(midi) && Math.abs(cents) <= FB_MATCH_CENTS_TOLERANCE;
  s._lastReading = { noteName, cents, midi, freq, isMatch, ts: now };
  fbRenderPitchMeter(s._lastReading, false);
  if (s.matched) return;

  if (isMatch) {
    s._holdCount++;
    s._wrongHoldCount = 0;
    if (s._holdCount >= FB_MATCH_HOLD_FRAMES) fbPitchOnMatch();
    return;
  }
  s._holdCount = 0;
  if (noteName === s._wrongNote) s._wrongHoldCount++;
  else { s._wrongNote = noteName; s._wrongHoldCount = 1; }
  if (s._wrongHoldCount === FB_WRONG_HOLD_FRAMES && performance.now() - s._lastWrongMsgAt > FB_WRONG_MSG_COOLDOWN_MS) {
    fbPitchOnWrong(noteName, midi);
  }
}

function fbPitchOnWrong(noteName, midi) {
  const s = fbState.pitch;
  s._lastWrongMsgAt = performance.now();
  const st = s.stats[s.target];
  if (st) { st.wrongHits++; fbPitchSaveStats(); }
  const fb = document.getElementById('fb-pitch-feedback');
  fb.textContent = `Not quite — heard ${noteName}${fbOctaveOf(midi)}, target is ${s.target}. Keep trying…`;
  fb.className = 'fb-feedback err';
}

function fbPitchOnMatch() {
  const s = fbState.pitch;
  s.matched = true;
  // exclude time the tab spent in the background (switched away, etc.) so a
  // distracted pause doesn't get counted as "slow to find the note"
  const elapsedMs = performance.now() - s.startTime - (s._hiddenMs || 0);
  s.total++; s.matches++; s.streak++;
  const st = s.stats[s.target];
  st.matched++; st.totalMs += elapsedMs;
  fbPitchSaveStats();
  fbRenderPitchStats();
  fbRenderPitchStatsTable();
  const fb = document.getElementById('fb-pitch-feedback');
  fb.textContent = `Matched ${s.target} in ${(elapsedMs / 1000).toFixed(1)}s!`;
  fb.className = 'fb-feedback ok';
  setTimeout(fbPitchNewNote, 900);
}

// ── Tuner (auto-detects nearest string from pitch, shows sharp/flat + in-tune) ──

const FB_TUNER_TOLERANCE_CENTS = 5;
const FB_TUNER_HOLD_FRAMES = 15; // ~0.25s sustained in-tune before marking a string done

// Tuner has no mode-specific options of its own — input/output device
// pickers now live in the shared fb-device-bar above the mode tabs.

function fbRenderTunerStrings() {
  const s = fbState.tuner;
  document.getElementById('fb-tuner-strings').innerHTML = FB_STRING_NAMES.map((n, i) => `
    <div class="fb-tuner-chip${s.tuned[i] ? ' done' : ''}${s.activeString === i ? ' active' : ''}">${n}${i===0?' (6)':i===5?' (1)':''}</div>
  `).join('');
}

async function fbTunerStart() {
  try {
    await fbMicStart('tuner', fbTunerOnFrame);
  } catch (e) {
    const fb = document.getElementById('fb-tuner-hint');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('tuner');
}

function fbTunerStop() {
  fbMicStop();
  fbSyncMicButtons('tuner');
  document.getElementById('fb-tuner-meter').innerHTML = '';
  fbState.tuner.activeString = -1;
  fbRenderTunerStrings();
}

function fbTunerReset() {
  fbState.tuner.tuned = [false, false, false, false, false, false];
  fbRenderTunerStrings();
}

function fbRenderTunerMeter(r) {
  const meter = document.getElementById('fb-tuner-meter');
  const inTune = Math.abs(r.cents) <= FB_TUNER_TOLERANCE_CENTS;
  const dir = inTune ? 'In tune ✓' : (r.cents < 0 ? 'Too low — tune UP ⬆' : 'Too high — tune DOWN ⬇');
  meter.innerHTML = `
    <div class="fb-pitch-detected${inTune ? ' match' : ''}${r.held ? ' held' : ''}">${FB_STRING_NAMES[r.string]} string<span class="fb-pitch-octave">${r.via}</span></div>
    <div class="fb-pitch-cents-bar"><div class="fb-pitch-cents-needle" style="left:${50 + Math.max(-50, Math.min(50, r.cents))}%"></div></div>
    <div class="fb-pitch-hz">${r.freq.toFixed(1)} Hz &nbsp;·&nbsp; ${r.cents > 0 ? '+' : ''}${r.cents.toFixed(0)} cents &nbsp;·&nbsp; ${dir}</div>
  `;
}

function fbTunerOnFrame(analyser, sampleRate) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  const s = fbState.tuner;
  const meter = document.getElementById('fb-tuner-meter');
  const now = performance.now();

  if (!(freq > 0 && freq >= 60 && freq <= 1500)) {
    // hold the last reading briefly instead of vanishing the instant the note decays
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderTunerMeter({ ...s._lastReading, held: true });
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">—</div><div class="fb-pitch-hz">play a string…</div>`;
      s.activeString = -1;
      fbRenderTunerStrings();
    }
    s._holdCount = 0;
    return;
  }

  // Match against every string's open pitch AND its 12th-fret (octave-up) pitch,
  // and take whichever reference is closest — so open-string or 12th-fret
  // harmonic playing both work for tuning.
  let best = null;
  for (let i = 0; i < 6; i++) {
    [0, 12].forEach(offset => {
      const refFreq = fbFreqFromMidi(FB_STRING_OPEN_MIDI[i] + offset);
      const cents = 1200 * Math.log2(freq / refFreq);
      if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { string: i, cents, via: offset === 0 ? 'open' : '12th-fret' };
    });
  }

  if (!best || Math.abs(best.cents) > 60) {
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderTunerMeter({ ...s._lastReading, held: true });
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">${freq.toFixed(1)} Hz</div><div class="fb-pitch-hz">no clear string match — play one string at a time</div>`;
      s.activeString = -1;
      fbRenderTunerStrings();
    }
    s._holdCount = 0;
    return;
  }

  s.activeString = best.string;
  s._lastReading = { string: best.string, cents: best.cents, via: best.via, freq, ts: now };
  fbRenderTunerMeter(s._lastReading);

  const inTune = Math.abs(best.cents) <= FB_TUNER_TOLERANCE_CENTS;
  if (inTune) {
    s._holdCount = (s._holdString === best.string) ? s._holdCount + 1 : 1;
    s._holdString = best.string;
    if (s._holdCount >= FB_TUNER_HOLD_FRAMES) s.tuned[best.string] = true;
  } else {
    s._holdCount = 0; s._holdString = -1;
  }
  fbRenderTunerStrings();
}

// ── Chord Match drill (mic-based chord sight-reading) ──
//
// Chords are polyphonic, so monophonic autocorrelation doesn't apply here.
// Instead this uses a chroma / pitch-class profile (PCP): FFT the signal,
// fold spectral energy from every bin into one of 12 pitch-class buckets
// (ignoring octave), then compare that 12-value "which notes are ringing"
// vector against a template for the target chord via cosine similarity.
// This only checks pitch content, not voicing — any shape/inversion that
// contains the right notes will match, which is what "sight-reading a
// chord symbol" should reward. It's inherently less precise than single-note
// detection (strum noise, muted strings, room noise all leak in), so the
// match threshold is deliberately conservative.

// interval sets in semitones from the root
const FB_CHORD_QUALITIES = {
  '':     [0, 4, 7],      // major
  'm':    [0, 3, 7],      // minor
  'maj7': [0, 4, 7, 11],  // major 7
  '7':    [0, 4, 7, 10],  // dominant 7
  'm7':   [0, 3, 7, 10],  // minor 7
  'dim7': [0, 3, 6, 9],   // fully diminished 7
  'm7b5': [0, 3, 6, 10],  // half-diminished 7 (minor 7 flat 5)
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
};
const FB_CHORD_QUALITY_LABELS = {
  '': 'Major', 'm': 'Minor', 'maj7': 'Maj7', '7': 'Dominant 7', 'm7': 'Minor 7',
  'dim7': 'Diminished 7', 'm7b5': 'Half-dim 7 (m7♭5)', 'sus2': 'Sus2', 'sus4': 'Sus4',
};
// scale-degree formula for each quality, in the same order as FB_CHORD_QUALITIES[quality]
const FB_CHORD_DEGREE_LABELS = {
  '':     ['1', '3', '5'],
  'm':    ['1', 'b3', '5'],
  'maj7': ['1', '3', '5', '7'],
  '7':    ['1', '3', '5', 'b7'],
  'm7':   ['1', 'b3', '5', 'b7'],
  'dim7': ['1', 'b3', 'b5', 'bb7'],
  'm7b5': ['1', 'b3', 'b5', 'b7'],
  'sus2': ['1', '2', '5'],
  'sus4': ['1', '4', '5'],
};
function fbChordFormula(quality) {
  return FB_CHORD_QUALITIES[quality].map((iv, idx) => FB_CHORD_DEGREE_LABELS[quality][idx]).join('  ');
}
// Two ways to spell a chord symbol: plain/standard, or classic jazz notation
// (as used by iReal Pro and jazz lead sheets: "-" for minor, "Δ7" for major7,
// "°7" for diminished7, "ø7" for half-diminished). Purely a display choice —
// the internal `quality` key (used for matching/stats) never changes.
const FB_CHORD_NOTATION_STYLES = {
  standard: { label: 'Standard (Cm, Cmaj7, Cm7b5)',
    suffixes: { '': '', m: 'm', maj7: 'maj7', '7': '7', m7: 'm7', dim7: 'dim7', m7b5: 'm7b5', sus2: 'sus2', sus4: 'sus4' } },
  jazz: { label: 'Jazz / iReal Pro (C-, CΔ7, Cø7)',
    suffixes: { '': '', m: '-', maj7: 'Δ7', '7': '7', m7: '-7', dim7: '°7', m7b5: 'ø7', sus2: 'sus2', sus4: 'sus4' } },
};
function fbChordDisplaySymbol(root, quality) {
  const style = FB_CHORD_NOTATION_STYLES[fbState.chord.notationStyle] || FB_CHORD_NOTATION_STYLES.standard;
  return FB_NOTE_NAMES[root] + style.suffixes[quality];
}

// Per-string scale-degree label for a shape (e.g. the classic "1 5 1 3 5 1"
// used to memorize the E-shape major barre chord). Computed from the shape's
// own string offsets, independent of which actual root/fret it's barred at.
function fbShapeDegreeLabels(shape, quality) {
  const intervals = FB_CHORD_QUALITIES[quality];
  const degreeLabels = FB_CHORD_DEGREE_LABELS[quality];
  const intervalToLabel = {};
  intervals.forEach((iv, idx) => { intervalToLabel[iv] = degreeLabels[idx]; });
  const rootBase = FB_STRING_OPEN[shape.rootString] + shape.rootFret;
  return shape.frets.map((v, i) => {
    if (v === 'x') return null;
    const offset = ((FB_STRING_OPEN[i] + v - rootBase) % 12 + 12) % 12;
    return intervalToLabel[offset] || '?';
  });
}
// Two-tier selection: the group checkbox is a bulk toggle for every quality
// inside it (all-on/all-off), but each quality underneath can still be
// switched individually — group checkbox shows an indeterminate dash when
// the group is only partly selected.
const FB_CHORD_GROUPS = {
  triad:   { label: 'Triads', qualities: ['', 'm'] },
  seventh: { label: '7th Chords', qualities: ['maj7', '7', 'm7', 'dim7', 'm7b5'] },
  sus:     { label: 'Sus Chords', qualities: ['sus2', 'sus4'] },
};
const FB_CHORD_MATCH_SIM = 0.82;
const FB_CHORD_WRONG_SIM = 0.68;
const FB_CHORD_MATCH_HOLD_FRAMES = 15;   // ~0.25s sustained — chords need a beat to ring out
const FB_CHORD_WRONG_HOLD_FRAMES = 15;
const FB_CHORD_WRONG_MSG_COOLDOWN_MS = 900;
const FB_CHORD_STATS_KEY = 'fb_chord_stats';
const FB_CHORD_MIN_HZ = 70, FB_CHORD_MAX_HZ = 1200, FB_CHORD_NOISE_FLOOR_DB = -70;

// Movable barre-chord voicings for Learn Mode, keyed by shape family then
// quality. These are the standard E/A/D "CAGED" families — the three shapes
// guitarists actually use as movable barre chords (unlike the C/A/G/E/D
// open-position set, C and G aren't practical barre shapes past the nut).
// Each pattern is { frets, rootFret }: rootFret is which fret (within the
// pattern's own numbering) carries the root note — usually 0, but dim7/m7b5
// shapes below need it >0 because the lowest fretted note in the barre isn't
// always the root.
//
// Major/minor/7th/maj7/sus2/sus4 patterns are derived directly from the
// well-known open chord of that name (e.g. E-shape 'm7' is literally open
// Em7: 0,2,0,0,0,0). dim7 and m7b5 aren't open-chord derivatives — they're
// sourced from published movable fingerings and verified here against the
// chord's own interval formula before use:
//   - dim7 E-shape from Gdim7 "3x232x" (guitarcommand.com / fachords.com)
//   - dim7 A-shape from Cdim7 "x3424x" (fachords.com)
//   - dim7 D-shape derived analytically (E/A "root-below-barre" pattern
//     extended to the D-string family), verified against the formula
//   - m7b5 E-shape from Am7b5 "5x554x" (guitarcommand.com)
//   - m7b5 A-shape from Bm7b5 "x2323x" (fachords.com)
//   - m7b5 D-shape from Em7b5 "xx2333" (fachords.com)
const FB_MOVABLE_SHAPES = {
  E: { rootString: 0, patterns: {
    '':     { frets: [0, 2, 2, 1, 0, 0], rootFret: 0 },
    'm':    { frets: [0, 2, 2, 0, 0, 0], rootFret: 0 },
    '7':    { frets: [0, 2, 0, 1, 0, 0], rootFret: 0 },
    'm7':   { frets: [0, 2, 0, 0, 0, 0], rootFret: 0 },
    'maj7': { frets: [0, 2, 1, 1, 0, 0], rootFret: 0 },
    'dim7': { frets: [1, 'x', 0, 1, 0, 'x'], rootFret: 1 },
    'm7b5': { frets: [1, 'x', 1, 1, 0, 'x'], rootFret: 1 },
    'sus2': { frets: [0, 2, 4, 4, 0, 0], rootFret: 0 },
    'sus4': { frets: [0, 2, 2, 2, 0, 0], rootFret: 0 },
  }},
  A: { rootString: 1, patterns: {
    '':     { frets: ['x', 0, 2, 2, 2, 0], rootFret: 0 },
    'm':    { frets: ['x', 0, 2, 2, 1, 0], rootFret: 0 },
    '7':    { frets: ['x', 0, 2, 0, 2, 0], rootFret: 0 },
    'm7':   { frets: ['x', 0, 2, 0, 1, 0], rootFret: 0 },
    'maj7': { frets: ['x', 0, 2, 1, 2, 0], rootFret: 0 },
    'dim7': { frets: ['x', 1, 2, 0, 2, 'x'], rootFret: 1 },
    'm7b5': { frets: ['x', 0, 1, 0, 1, 'x'], rootFret: 0 },
    'sus2': { frets: ['x', 0, 2, 2, 0, 0], rootFret: 0 },
    'sus4': { frets: ['x', 0, 2, 2, 3, 0], rootFret: 0 },
  }},
  D: { rootString: 2, patterns: {
    '':     { frets: ['x', 'x', 0, 2, 3, 2], rootFret: 0 },
    'm':    { frets: ['x', 'x', 0, 2, 3, 1], rootFret: 0 },
    '7':    { frets: ['x', 'x', 0, 2, 1, 2], rootFret: 0 },
    'm7':   { frets: ['x', 'x', 0, 2, 1, 1], rootFret: 0 },
    'maj7': { frets: ['x', 'x', 0, 2, 2, 2], rootFret: 0 },
    'dim7': { frets: ['x', 'x', 0, 1, 0, 1], rootFret: 0 },
    'm7b5': { frets: ['x', 'x', 0, 1, 1, 1], rootFret: 0 },
    'sus2': { frets: ['x', 'x', 0, 2, 3, 0], rootFret: 0 },
    'sus4': { frets: ['x', 'x', 0, 2, 3, 3], rootFret: 0 },
  }},
};

// E-shape sus2 spans 5 frets and is rarely playable; skip it to match the
// reference sheet which also excludes it.
const FB_SKIP_E_SHAPE = new Set(['sus2']);
// E-shape 7th chords have a practical no-barre variant (mute A and high-e).
const FB_NOBARRE_QUALITIES = new Set(['7', 'm7', 'maj7']);
// Shell chords: root + 3rd + 7th (no 5th).  Fret offsets relative to barre.
// Verified: E root str0 open=4 → Dstr@0=b7, Gstr@1=maj3; Astr@0=b7 (for D-shape root)...
const FB_SHELL_PATTERNS = {
  E: { '7': [0,'x',0,1,'x','x'], 'm7': [0,'x',0,0,'x','x'], 'maj7': [0,'x',1,1,'x','x'] },
  A: { '7': ['x',0,'x',0,2,'x'], 'm7': ['x',0,'x',0,1,'x'], 'maj7': ['x',0,'x',1,2,'x'] },
  D: { '7': ['x','x',0,'x',1,2], 'm7': ['x','x',0,'x',1,1], 'maj7': ['x','x',0,'x',2,2] },
};

function fbRenderChordShapeDiagrams(chord) {
  const el = document.getElementById('fb-chord-diagrams');
  el.innerHTML = '';
  ['E', 'A', 'D'].forEach(letter => {
    // Skip impractical E-shape voicings
    if (letter === 'E' && FB_SKIP_E_SHAPE.has(chord.quality)) return;

    const family = FB_MOVABLE_SHAPES[letter];
    const pattern = family.patterns[chord.quality];
    const card = document.createElement('div');
    card.className = 'fb-shape-card';
    const title = document.createElement('div');
    title.className = 'fb-shape-card-title';
    title.textContent = `${letter}-shape`;
    card.appendChild(title);

    if (!pattern) {
      const empty = document.createElement('div');
      empty.className = 'fb-shape-card-empty';
      empty.textContent = `No standard ${letter}-shape voicing for this chord type.`;
      card.appendChild(empty);
    } else {
      const shape = { frets: pattern.frets, rootString: family.rootString, rootFret: pattern.rootFret };
      const barreFret = fbBarreFretForShape(chord.root, shape);
      const degreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(shape, chord.quality) : null;
      const boardWrap = document.createElement('div');
      card.appendChild(boardWrap);
      fbRenderShapeBox(boardWrap, shape, barreFret, degreeLabels);
    }
    el.appendChild(card);

    // For E-shape 7th chords, append the no-barre variant right after.
    // Mute string index 1 (A) and index 5 (high-e) so no barre is required.
    if (letter === 'E' && FB_NOBARRE_QUALITIES.has(chord.quality) && pattern) {
      const nobarreFrets = pattern.frets.map((v, i) => (i === 1 || i === 5) ? 'x' : v);
      const nobarreShape = { frets: nobarreFrets, rootString: family.rootString, rootFret: pattern.rootFret };
      const nbBarreFret = fbBarreFretForShape(chord.root, nobarreShape);
      const nbDegreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(nobarreShape, chord.quality) : null;
      const nbCard = document.createElement('div');
      nbCard.className = 'fb-shape-card';
      const nbTitle = document.createElement('div');
      nbTitle.className = 'fb-shape-card-title';
      nbTitle.textContent = 'E-shape（免横按）';
      nbCard.appendChild(nbTitle);
      const nbWrap = document.createElement('div');
      nbCard.appendChild(nbWrap);
      fbRenderShapeBox(nbWrap, nobarreShape, nbBarreFret, nbDegreeLabels, true);
      el.appendChild(nbCard);
    }
  });

  // Shell chords (root + 3rd + 7th, no 5th) for 7th chord qualities — added
  // after all standard/nobarre cards to match the reference sheet layout.
  if (FB_NOBARRE_QUALITIES.has(chord.quality)) {
    ['E', 'A', 'D'].forEach(letter => {
      const shellFrets = FB_SHELL_PATTERNS[letter] && FB_SHELL_PATTERNS[letter][chord.quality];
      if (!shellFrets) return;
      const family = FB_MOVABLE_SHAPES[letter];
      const shShape = { frets: shellFrets, rootString: family.rootString, rootFret: 0 };
      const shBarreFret = fbBarreFretForShape(chord.root, shShape);
      const shDegreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(shShape, chord.quality) : null;
      const shCard = document.createElement('div');
      shCard.className = 'fb-shape-card';
      const shTitle = document.createElement('div');
      shTitle.className = 'fb-shape-card-title';
      shTitle.textContent = `${letter}-shape（壳）`;
      shCard.appendChild(shTitle);
      const shWrap = document.createElement('div');
      shCard.appendChild(shWrap);
      fbRenderShapeBox(shWrap, shShape, shBarreFret, shDegreeLabels, true);
      el.appendChild(shCard);
    });
  }
}

function fbChordLoadStats() {
  try { fbState.chord.stats = JSON.parse(localStorage.getItem(FB_CHORD_STATS_KEY)) || {}; }
  catch (_) { fbState.chord.stats = {}; }
}
function fbChordSaveStats() {
  localStorage.setItem(FB_CHORD_STATS_KEY, JSON.stringify(fbState.chord.stats));
}

function fbChordSymbol(root, quality) {
  return FB_NOTE_NAMES[root] + quality;
}

function fbChordGroupState(g) {
  const quals = FB_CHORD_GROUPS[g].qualities;
  const checkedCount = quals.filter(q => fbState.chord.qualities[q]).length;
  if (checkedCount === 0) return 'none';
  if (checkedCount === quals.length) return 'all';
  return 'partial';
}

function fbRenderChordOptions() {
  const s = fbState.chord;
  const q = s.qualities;
  document.getElementById('fb-chord-options').innerHTML = `
    <span>Notation:</span>
    <select onchange="fbState.chord.notationStyle=this.value; fbPrefsSave(); fbChordRefreshLabels()">
      ${Object.keys(FB_CHORD_NOTATION_STYLES).map(k => `<option value="${k}" ${s.notationStyle===k?'selected':''}>${FB_CHORD_NOTATION_STYLES[k].label}</option>`).join('')}
    </select>
    <span style="margin-left:12px">Chord source:</span>
    <select onchange="fbChordSetSource(this.value)">
      <option value="random"      ${s.source==='random'     ?'selected':''}>Random</option>
      <option value="fixed_root"  ${s.source==='fixed_root' ?'selected':''}>Fixed root — same root, random quality</option>
      <option value="progression" ${s.source==='progression'?'selected':''}>Progressions (I-V-vi-IV, ii-V-I, etc.)</option>
    </select>
    ${s.source === 'fixed_root' ? `
    <label style="margin-left:8px">Root:
      <select onchange="fbState.chord.fixedRoot=parseInt(this.value); fbPrefsSave(); fbChordNewChord()">
        ${FB_NOTE_NAMES.map((n, i) => `<option value="${i}" ${s.fixedRoot===i?'selected':''}>${n}</option>`).join('')}
      </select>
    </label>` : ''}
    <div class="fb-chord-type-groups">
      ${Object.keys(FB_CHORD_GROUPS).map(g => `
        <div class="fb-chord-type-group">
          <label class="fb-chord-group-label"><input type="checkbox" class="fb-chord-group-cb" data-group="${g}" onchange="fbChordToggleGroup('${g}')"> ${FB_CHORD_GROUPS[g].label}</label>
          <span class="fb-chord-type-children">
            ${FB_CHORD_GROUPS[g].qualities.map(qk => `
              <label><input type="checkbox" ${q[qk] ? 'checked' : ''} onchange="fbChordToggleQuality('${qk}')"> ${FB_CHORD_QUALITY_LABELS[qk]}</label>
            `).join('')}
          </span>
        </div>
      `).join('')}
      <div class="fb-chord-type-group">
        <label><input type="checkbox" ${s.showFormula ? 'checked' : ''} onchange="fbState.chord.showFormula=this.checked; fbPrefsSave(); fbChordRefreshLabels()"> Show chord formula (e.g. 1 b3 5 b7)</label>
        <label><input type="checkbox" ${s.showChordDiagram ? 'checked' : ''} onchange="fbState.chord.showChordDiagram=this.checked; fbPrefsSave(); fbChordRefreshLabels()"> Show chord shape diagrams (E/A/D-shape)</label>
        <label><input type="checkbox" ${s.showDegreesOnDiagram ? 'checked' : ''} onchange="fbState.chord.showDegreesOnDiagram=this.checked; fbPrefsSave(); fbChordRefreshLabels()"> Show degree labels on shape diagrams</label>
        <label style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap">
          📐 Diagram size:
          <input type="range" min="100" max="300" step="10" value="${s.diagramSize || 200}"
            oninput="fbState.chord.diagramSize=parseInt(this.value); fbPrefsSave(); fbApplyDiagramSize(); fbChordRefreshLabels(); document.getElementById('fb-diagram-size-val').textContent=this.value+'px'">
          <span id="fb-diagram-size-val">${s.diagramSize || 200}px</span>
        </label>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="fbChordResetStats()">Reset stats</button>
  `;
  // indeterminate is JS-only, can't be expressed as an HTML attribute
  document.querySelectorAll('.fb-chord-group-cb').forEach(cb => {
    const st = fbChordGroupState(cb.dataset.group);
    cb.checked = st === 'all';
    cb.indeterminate = st === 'partial';
  });
}

function fbChordToggleGroup(g) {
  const turnOn = fbChordGroupState(g) !== 'all'; // not fully on yet → select all; already all on → clear
  FB_CHORD_GROUPS[g].qualities.forEach(qk => { fbState.chord.qualities[qk] = turnOn; });
  if (!Object.values(fbState.chord.qualities).some(Boolean)) FB_CHORD_GROUPS[g].qualities.forEach(qk => { fbState.chord.qualities[qk] = true; });
  fbState.chord.progression.chords = null; // stale — enabled qualities changed
  fbPrefsSave();
  fbRenderChordOptions();
}

function fbChordToggleQuality(qk) {
  const qs = fbState.chord.qualities;
  qs[qk] = !qs[qk];
  if (!Object.values(qs).some(Boolean)) qs[qk] = true; // keep at least one
  fbState.chord.progression.chords = null; // stale — enabled qualities changed
  fbPrefsSave();
  fbRenderChordOptions();
}

function fbChordSetSource(source) {
  fbState.chord.source = source;
  fbState.chord.progression.chords = null;
  fbPrefsSave();
  fbRenderChordOptions();  // re-render to show/hide root picker
  fbChordNewChord();
}

function fbChordResetStats() {
  fbState.chord.stats = {};
  fbChordSaveStats();
  fbRenderChordStatsTable();
}

// 12-value weight vector for a chord: root strongest, third/fifth present,
// everything else a small non-zero baseline so an otherwise-clean chroma
// isn't penalized to zero by string noise / open-string bleed.
function fbChordTemplate(root, quality) {
  const intervals = FB_CHORD_QUALITIES[quality];
  const template = new Array(12).fill(0.12);
  intervals.forEach((iv, idx) => {
    const pc = (root + iv) % 12;
    template[pc] = idx === 0 ? 1.0 : 0.75;
  });
  return template;
}

function fbCosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < 12; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

// Cosine similarity alone under-discriminates triads vs. their 7th-chord
// extensions: a plain triad already covers 3 of a 7th chord's 4 tones, which
// is enough overlap to clear the similarity threshold even though the 7th
// itself never sounded. This gate requires every interval in the chord to
// actually have energy present, so a missing tone (e.g. no minor 7th when
// you only played the triad) can't pass as that 7th chord.
const FB_CHORD_MIN_TONE_PRESENCE = 0.3;
function fbChordCoverageOk(chroma, root, quality) {
  return FB_CHORD_QUALITIES[quality].every(iv => chroma[(root + iv) % 12] >= FB_CHORD_MIN_TONE_PRESENCE);
}

function fbChordEnabledPool() {
  const qs = fbState.chord.qualities;
  const pool = [];
  for (const q of Object.keys(FB_CHORD_QUALITIES)) {
    if (!qs[q]) continue;
    for (let root = 0; root < 12; root++) pool.push({ root, quality: q, symbol: fbChordSymbol(root, q) });
  }
  return pool;
}

// ── Chord progression mode: instead of a uniformly random chord every time,
// walk through a real chord-progression "lick" (I-V-vi-IV, ii-V-I, etc.) in
// a randomly chosen key, then pick a new progression/key once it's done.
// Each diatonic degree lists candidate qualities in preference order (plain
// triad first, then its 7th-chord extension) — whichever is actually
// enabled in the user's quality checkboxes gets used, so this respects the
// existing quality filter rather than fighting it.
const FB_MAJOR_SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const FB_MINOR_SCALE_OFFSETS = [0, 2, 3, 5, 7, 8, 10];
const FB_MAJOR_DEGREE_QUALITIES = [
  ['', 'maj7'],    // I
  ['m', 'm7'],     // ii
  ['m', 'm7'],     // iii
  ['', 'maj7'],    // IV
  ['', '7'],       // V
  ['m', 'm7'],     // vi
  ['m7b5', 'dim7'],// vii°
];
const FB_MINOR_DEGREE_QUALITIES = [
  ['m', 'm7'],     // i
  ['m7b5', 'dim7'],// ii°
  ['', 'maj7'],    // III
  ['m', 'm7'],     // iv
  ['m', 'm7'],     // v
  ['', 'maj7'],    // VI
  ['', '7'],       // VII
];
const FB_CHORD_PROGRESSIONS = [
  { name: 'I – V – vi – IV (pop)', keyType: 'major', degrees: [0, 4, 5, 3] },
  { name: 'I – vi – IV – V (50s / doo-wop)', keyType: 'major', degrees: [0, 5, 3, 4] },
  { name: 'ii – V – I (jazz)', keyType: 'major', degrees: [1, 4, 0] },
  { name: 'I – IV – V – IV', keyType: 'major', degrees: [0, 3, 4, 3] },
  { name: 'vi – IV – I – V', keyType: 'major', degrees: [5, 3, 0, 4] },
  { name: 'I – vi – ii – V (turnaround)', keyType: 'major', degrees: [0, 5, 1, 4] },
  { name: 'iii – vi – ii – V (jazz turnaround)', keyType: 'major', degrees: [2, 5, 1, 4] },
  { name: '12-bar blues (changes)', keyType: 'major', degrees: [0, 3, 0, 4, 3, 0] },
  { name: 'i – VI – III – VII (minor pop)', keyType: 'minor', degrees: [0, 5, 2, 6] },
  { name: 'i – iv – v (minor)', keyType: 'minor', degrees: [0, 3, 4] },
  { name: 'i – VII – VI – VII', keyType: 'minor', degrees: [0, 6, 5, 6] },
];

// The first enabled quality among a degree's candidates, or null if the user
// has disabled every quality that degree could plausibly use.
function fbChordBestQualityFor(degreeIdx, keyType) {
  const candidates = (keyType === 'minor' ? FB_MINOR_DEGREE_QUALITIES : FB_MAJOR_DEGREE_QUALITIES)[degreeIdx];
  // NB: '' (major triad) is a valid quality but JS-falsy — can't use `|| null` here.
  const found = candidates.find(q => fbState.chord.qualities[q]);
  return found !== undefined ? found : null;
}

// A progression only qualifies if every degree it uses resolves to some
// enabled quality — otherwise we'd be asking the user to strum a chord type
// they've explicitly turned off.
function fbChordEligibleProgressions() {
  // NB: fbChordBestQualityFor can validly return '' (major triad) — check
  // against null explicitly rather than truthiness.
  return FB_CHORD_PROGRESSIONS.filter(p => p.degrees.every(d => fbChordBestQualityFor(d, p.keyType) !== null));
}

// Builds the concrete { root, quality, symbol } list for one pass through a
// progression in a given key, then — about 30% of the time — drops in a
// secondary dominant (V7 of the following chord) before some middle chord,
// just for a bit of harmonic variety. Only happens if '7' is enabled.
function fbChordBuildProgressionChords(prog, keyRoot) {
  const offsets = prog.keyType === 'minor' ? FB_MINOR_SCALE_OFFSETS : FB_MAJOR_SCALE_OFFSETS;
  const chords = prog.degrees.map(d => {
    const root = (keyRoot + offsets[d]) % 12;
    const quality = fbChordBestQualityFor(d, prog.keyType);
    return { root, quality, symbol: fbChordSymbol(root, quality) };
  });
  if (fbState.chord.qualities['7'] && chords.length > 2 && Math.random() < 0.3) {
    const insertAt = 1 + Math.floor(Math.random() * (chords.length - 1)); // never before the very first chord
    const target = chords[insertAt];
    const secDom = { root: (target.root + 7) % 12, quality: '7' };
    chords.splice(insertAt, 0, { ...secDom, symbol: fbChordSymbol(secDom.root, secDom.quality) });
  }
  return chords;
}

function fbChordPickTargetRandom() {
  const pool = fbChordEnabledPool();
  return pool[Math.floor(Math.random() * pool.length)];
}

function fbChordPickTargetFixedRoot() {
  const s = fbState.chord;
  const root = s.fixedRoot;
  const enabledQ = Object.keys(FB_CHORD_QUALITIES).filter(q => s.qualities[q]);
  if (!enabledQ.length) return fbChordPickTargetRandom();
  // Avoid repeating the same quality consecutively
  const prevQ = s.target ? s.target.quality : null;
  const pool  = enabledQ.length > 1 ? enabledQ.filter(q => q !== prevQ) : enabledQ;
  const quality = pool[Math.floor(Math.random() * pool.length)];
  return { root, quality, symbol: fbChordSymbol(root, quality) };
}

function fbChordPickTargetProgression() {
  const s = fbState.chord;
  const p = s.progression;
  if (!p.chords || p.stepIdx >= p.chords.length) {
    const eligible = fbChordEligibleProgressions();
    if (!eligible.length) return fbChordPickTargetRandom(); // no progression fits the enabled qualities — fall back
    p.def = eligible[Math.floor(Math.random() * eligible.length)];
    p.keyRoot = Math.floor(Math.random() * 12);
    p.chords = fbChordBuildProgressionChords(p.def, p.keyRoot);
    p.stepIdx = 0;
  }
  return p.chords[p.stepIdx++];
}

function fbChordPickTarget() {
  if (fbState.chord.source === 'fixed_root') return fbChordPickTargetFixedRoot();
  if (fbState.chord.source === 'progression') return fbChordPickTargetProgression();
  return fbChordPickTargetRandom();
}

function fbRenderChordStats() {
  const s = fbState.chord;
  document.getElementById('fb-chord-stats').innerHTML = `
    <span class="fb-stat-ok">Matches <b>${s.matches}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbRenderChordStatsTable() {
  const s = fbState.chord;
  const el = document.getElementById('fb-chord-stats-table');
  if (!el) return;
  const rows = Object.keys(s.stats).map(sym => {
    const st = s.stats[sym];
    const acc = st.presented ? Math.round((st.matched / st.presented) * 100) : null;
    const avg = st.matched ? (st.totalMs / st.matched / 1000).toFixed(1) : null;
    // older saved stats (pre-notation-style) don't carry root/quality — fall back to the raw key
    const label = (st.root != null && st.quality != null) ? fbChordDisplaySymbol(st.root, st.quality) : sym;
    return { label, presented: st.presented, acc, avg, wrong: st.wrongHits || 0 };
  }).filter(r => r.presented > 0)
    .sort((a, b) => (a.acc ?? 999) - (b.acc ?? 999) || (b.avg ?? 0) - (a.avg ?? 0));
  if (!rows.length) {
    el.innerHTML = '<span style="color:#aaa;font-size:12px">No attempts yet — start listening and strum some chords.</span>';
    return;
  }
  el.innerHTML = `
    <table class="fb-stats-table">
      <tr><th>Chord</th><th>Tries</th><th>Accuracy</th><th>Avg time</th><th>Wrong hits</th></tr>
      ${rows.map(r => `<tr><td>${r.label}</td><td>${r.presented}</td><td>${r.acc}%</td><td>${r.avg ?? '—'}s</td><td>${r.wrong}</td></tr>`).join('')}
    </table>
  `;
}

function fbRenderChroma(chroma, target) {
  const el = document.getElementById('fb-chord-chroma');
  const chordTones = target ? new Set(FB_CHORD_QUALITIES[target.quality].map(iv => (target.root + iv) % 12)) : new Set();
  el.innerHTML = FB_NOTE_NAMES.map((n, i) => {
    const isTone = chordTones.has(i);
    const val = Math.max(0, Math.min(1, chroma[i] || 0));
    const hit = isTone && val > 0.5;
    return `
      <div class="fb-chroma-col${isTone ? ' chord-tone' : ''}${hit ? ' hit' : ''}">
        <div class="fb-chroma-bar" style="height:${Math.round(val * 100)}%"></div>
        <div class="fb-chroma-label">${n}</div>
      </div>
    `;
  }).join('');
}

function fbChordNewChord() {
  const s = fbState.chord;
  const t = fbChordPickTarget();
  s.target = t;
  s.matched = false;
  s._holdCount = 0;
  s._wrongSymbol = null;
  s._wrongHoldCount = 0;
  s.startTime = performance.now();
  s._hiddenMs = 0;
  s._hiddenSince = document.hidden ? s.startTime : null;
  const st = s.stats[t.symbol] || (s.stats[t.symbol] = { root: t.root, quality: t.quality, presented: 0, matched: 0, totalMs: 0, wrongHits: 0 });
  st.presented++;
  fbChordSaveStats();

  fbRenderChordStats();
  fbRenderChordStatsTable();
  fbRenderChroma(new Array(12).fill(0), t);
  const fb = document.getElementById('fb-chord-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
  fbChordRefreshLabels();
}

// Re-renders whatever's currently on screen (target symbol/formula, chord
// shape diagrams if enabled) to reflect a settings change, without
// generating a new chord.
function fbChordRenderProgressionInfo() {
  const el = document.getElementById('fb-chord-progression-info');
  if (!el) return;
  const s = fbState.chord;
  const p = s.progression;
  el.textContent = (s.source === 'progression' && p.def && p.chords)
    ? `Progression: ${p.def.name} in ${FB_NOTE_NAMES[p.keyRoot]} — chord ${p.stepIdx}/${p.chords.length}`
    : '';
}

function fbChordRefreshLabels() {
  const s = fbState.chord;
  fbChordRenderProgressionInfo();
  if (s.target) {
    document.getElementById('fb-chord-target').textContent = fbChordDisplaySymbol(s.target.root, s.target.quality);
    const formulaEl = document.getElementById('fb-chord-formula');
    if (formulaEl) formulaEl.textContent = s.showFormula ? fbChordFormula(s.target.quality) : '';
    const diagramsEl = document.getElementById('fb-chord-diagrams');
    if (diagramsEl) {
      if (s.showChordDiagram) fbRenderChordShapeDiagrams(s.target);
      else diagramsEl.innerHTML = '';
    }
  }
  fbRenderChordStatsTable();
}

async function fbChordStart() {
  try {
    // 32768 gives ~1.5Hz/bin at 48kHz — needed because the tightest semitone
    // gap on guitar (E2→F2, ~4.9Hz) is *smaller* than a bin at 8192, which
    // would smear a low bass note's energy into the wrong pitch class.
    await fbMicStart('chord', fbChordOnFrame, 32768);
  } catch (e) {
    const fb = document.getElementById('fb-chord-feedback');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('chord');
}

function fbChordStop() {
  fbMicStop();
  fbSyncMicButtons('chord');
  fbRenderChroma(new Array(12).fill(0), fbState.chord.target);
}

function fbComputeChroma(analyser, sampleRate) {
  const freqData = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqData);
  const binHz = sampleRate / analyser.fftSize;
  const minBin = Math.max(1, Math.floor(FB_CHORD_MIN_HZ / binHz));
  const maxBin = Math.min(freqData.length - 1, Math.ceil(FB_CHORD_MAX_HZ / binHz));
  const chroma = new Array(12).fill(0);
  for (let i = minBin; i <= maxBin; i++) {
    const db = freqData[i];
    if (db < FB_CHORD_NOISE_FLOOR_DB) continue;
    const amp = Math.pow(10, db / 20);
    const midi = 69 + 12 * Math.log2((i * binHz) / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    chroma[pc] += amp;
  }
  const max = Math.max(...chroma, 1e-9);
  return chroma.map(v => v / max);
}

function fbChordOnFrame(analyser, sampleRate) {
  const s = fbState.chord;
  const chroma = fbComputeChroma(analyser, sampleRate);
  const totalEnergy = chroma.reduce((a, b) => a + b, 0);

  if (totalEnergy < 0.5) { // effectively silent — nothing meaningful ringing
    fbRenderChroma(new Array(12).fill(0), s.target);
    s._holdCount = 0;
    return;
  }

  const targetTemplate = fbChordTemplate(s.target.root, s.target.quality);
  const sim = fbCosineSim(chroma, targetTemplate);
  const covered = fbChordCoverageOk(chroma, s.target.root, s.target.quality);
  fbRenderChroma(chroma, s.target);

  const simEl = document.getElementById('fb-chord-feedback');
  if (!s.matched && !(sim >= FB_CHORD_MATCH_SIM && covered)) {
    simEl.textContent = `Similarity to ${fbChordDisplaySymbol(s.target.root, s.target.quality)}: ${Math.round(sim * 100)}%`;
    simEl.className = 'fb-feedback';
  }
  if (s.matched) return;

  if (sim >= FB_CHORD_MATCH_SIM && covered) {
    s._holdCount++;
    s._wrongHoldCount = 0;
    if (s._holdCount >= FB_CHORD_MATCH_HOLD_FRAMES) fbChordOnMatch();
    return;
  }
  s._holdCount = 0;

  // find the closest-matching *other* known chord to give useful wrong feedback
  // (only consider chords whose tones are actually all present, not just correlated)
  let best = null;
  fbChordEnabledPool().forEach(c => {
    if (c.symbol === s.target.symbol) return;
    if (!fbChordCoverageOk(chroma, c.root, c.quality)) return;
    const csim = fbCosineSim(chroma, fbChordTemplate(c.root, c.quality));
    if (!best || csim > best.sim) best = { symbol: c.symbol, root: c.root, quality: c.quality, sim: csim };
  });
  if (best && best.sim >= FB_CHORD_WRONG_SIM) {
    if (best.symbol === s._wrongSymbol) s._wrongHoldCount++;
    else { s._wrongSymbol = best.symbol; s._wrongHoldCount = 1; }
    if (s._wrongHoldCount === FB_CHORD_WRONG_HOLD_FRAMES && performance.now() - s._lastWrongMsgAt > FB_CHORD_WRONG_MSG_COOLDOWN_MS) {
      fbChordOnWrong(best);
    }
  } else {
    s._wrongSymbol = null; s._wrongHoldCount = 0;
  }
}

function fbChordOnWrong(heard) {
  const s = fbState.chord;
  s._lastWrongMsgAt = performance.now();
  const st = s.stats[s.target.symbol];
  if (st) { st.wrongHits++; fbChordSaveStats(); }
  const fb = document.getElementById('fb-chord-feedback');
  fb.textContent = `Not quite — that sounds like ${fbChordDisplaySymbol(heard.root, heard.quality)}, target is ${fbChordDisplaySymbol(s.target.root, s.target.quality)}. Keep trying…`;
  fb.className = 'fb-feedback err';
}

function fbChordOnMatch() {
  const s = fbState.chord;
  s.matched = true;
  const elapsedMs = performance.now() - s.startTime - (s._hiddenMs || 0);
  s.total++; s.matches++; s.streak++;
  const st = s.stats[s.target.symbol];
  st.matched++; st.totalMs += elapsedMs;
  fbChordSaveStats();
  fbRenderChordStats();
  fbRenderChordStatsTable();
  const fb = document.getElementById('fb-chord-feedback');
  fb.textContent = `Matched ${fbChordDisplaySymbol(s.target.root, s.target.quality)} in ${(elapsedMs / 1000).toFixed(1)}s!`;
  fb.className = 'fb-feedback ok';
  setTimeout(fbChordNewChord, 1100);
}

// Autocorrelation-based pitch detector (standard ACF2+ technique):
// trims low-amplitude edges, autocorrelates, finds the first strong peak
// after the initial downslope, then refines it via parabolic interpolation.
function fbAutoCorrelate(buf, sampleRate, rmsThreshold = 0.01) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < rmsThreshold) return -1; // too quiet / silence

  // Trim leading/trailing near-silence so autocorrelation focuses on signal.
  // Fallback to the full buffer when the signal is consistently quiet (e.g. a
  // decaying bent string whose amplitude is below 0.2 throughout) rather than
  // returning -1 and discarding a valid but soft note.
  const THRES = 0.2;
  let start = 0;
  while (start < SIZE / 2 && Math.abs(buf[start]) < THRES) start++;
  let end = SIZE - 1;
  while (end > SIZE / 2 && Math.abs(buf[end]) < THRES) end--;
  const trimmed = (end > start) ? buf.slice(start, end) : buf;
  const n = trimmed.length;
  if (n < 2) return -1;

  const c = new Float32Array(n);
  for (let lag = 0; lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += trimmed[i] * trimmed[i + lag];
    c[lag] = sum;
  }

  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) d++;
  let maxPos = -1, maxVal = -1;
  for (let i = d; i < n; i++) {
    if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  }
  if (maxPos <= 0) return -1;

  const x1 = c[maxPos - 1], x2 = c[maxPos], x3 = maxPos + 1 < n ? c[maxPos + 1] : c[maxPos];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const refinedLag = a ? maxPos - b / (2 * a) : maxPos;
  if (refinedLag <= 0) return -1;
  return sampleRate / refinedLag;
}

function fbFreqToNote(freq) {
  const midiFloat = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const noteName = FB_NOTE_NAMES[((midi % 12) + 12) % 12];
  return { noteName, cents, midi };
}

// ── Key Map: relative major/minor lookup + scale-degree-to-chord lookup ──
// Two drills meant to be practiced separately then combined (see
// docs/caged-positional-progression-practice.md): given a chord, name its
// relative major/minor; given a key + Roman-numeral degree, name the chord.
// Speed at "Em -> G -> 1-6-4-5 = G-Em-C-D" is really just these two lookups
// chained, not a third thing to memorize on its own.

function fbKeymapSetMode(mode) {
  fbState.keymap.mode = mode;
  fbPrefsSave();
  document.querySelectorAll('#fb-keymap .fb-subtab').forEach(b => b.classList.toggle('active', b.dataset.keymapmode === mode));
  document.getElementById('fb-keymap-relative-panel').style.display = mode === 'relative' ? '' : 'none';
  document.getElementById('fb-keymap-degree-panel').style.display = mode === 'degree' ? '' : 'none';
}

function fbRenderRelativeStats() {
  const s = fbState.keymap.relative;
  document.getElementById('fb-keymap-relative-stats').innerHTML = `
    <span class="fb-stat-ok">Correct <b>${s.correct}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbRelativeNext() {
  const s = fbState.keymap.relative;
  s.locked = false;
  const rootPc = Math.floor(Math.random() * 12);
  const isMinor = Math.random() < 0.5;
  // minor root + 3 semitones = its relative major; major root + 9 (i.e. -3) = its relative minor
  const answerPc = isMinor ? (rootPc + 3) % 12 : (rootPc + 9) % 12;
  s.current = { rootPc, isMinor, answerPc };

  fbRenderRelativeStats();
  const chordName = FB_NOTE_NAMES[rootPc] + (isMinor ? 'm' : '');
  document.getElementById('fb-keymap-relative-prompt').innerHTML =
    `What's the root of the relative ${isMinor ? 'major' : 'minor'} of <b>${chordName}</b>?`;
  const ansEl = document.getElementById('fb-keymap-relative-answers');
  ansEl.innerHTML = FB_NOTE_NAMES.map(n => `<button class="fb-answer-btn" onclick="fbRelativeAnswer('${n}', this)">${n}</button>`).join('');
  const fb = document.getElementById('fb-keymap-relative-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
}

function fbRelativeAnswer(note, btnEl) {
  const s = fbState.keymap.relative;
  if (s.locked) return;
  s.locked = true;
  s.total++;
  const correct = FB_NOTE_NAMES.indexOf(note) === s.current.answerPc;
  if (correct) { s.correct++; s.streak++; } else { s.streak = 0; }
  btnEl.classList.add(correct ? 'correct' : 'wrong');

  const answerName = FB_NOTE_NAMES[s.current.answerPc] + (s.current.isMinor ? '' : 'm');
  const fb = document.getElementById('fb-keymap-relative-feedback');
  fb.textContent = correct ? `Correct — ${answerName}` : `${answerName} (you said ${note})`;
  fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
  fbRenderRelativeStats();
  setTimeout(fbRelativeNext, 900);
}

const FB_DEGREE_LABELS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const FB_DEGREE_QUALITIES = ['', 'm', 'm', '', '', 'm', 'dim'];
const FB_DEGREE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const FB_DEGREE_COMMON = [0, 3, 4, 5]; // I, IV, V, vi — the "1-6-4-5" family

function fbDegreeChordName(keyRootPc, degreeIdx) {
  const rootPc = (keyRootPc + FB_DEGREE_INTERVALS[degreeIdx]) % 12;
  return FB_NOTE_NAMES[rootPc] + FB_DEGREE_QUALITIES[degreeIdx];
}

function fbRenderDegreeOptions() {
  const s = fbState.keymap.degree;
  document.getElementById('fb-keymap-degree-options').innerHTML = `
    <label><input type="checkbox" ${s.fullSet ? 'checked' : ''}
      onchange="fbState.keymap.degree.fullSet=this.checked; fbPrefsSave(); fbDegreeNext()"> Full diatonic set (I–vii°), not just I/IV/V/vi</label>
  `;
}

function fbRenderDegreeStats() {
  const s = fbState.keymap.degree;
  document.getElementById('fb-keymap-degree-stats').innerHTML = `
    <span class="fb-stat-ok">Correct <b>${s.correct}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbDegreeNext() {
  const s = fbState.keymap.degree;
  s.answered = false;
  const keyRootPc = Math.floor(Math.random() * 12);
  const pool = s.fullSet ? [0, 1, 2, 3, 4, 5, 6] : FB_DEGREE_COMMON;
  const degreeIdx = pool[Math.floor(Math.random() * pool.length)];
  const answerRootPc = (keyRootPc + FB_DEGREE_INTERVALS[degreeIdx]) % 12;
  s.current = { keyRootPc, degreeIdx, answerRootPc, answer: fbDegreeChordName(keyRootPc, degreeIdx) };

  fbRenderDegreeStats();
  document.getElementById('fb-keymap-degree-prompt').innerHTML =
    `In <b>${FB_NOTE_NAMES[keyRootPc]} major</b>, what chord is the <b>${FB_DEGREE_LABELS[degreeIdx]}</b>?`;

  // All 12 notes, not just the key's diatonic set — picking the right root
  // pitch class is the actual skill; its quality (maj/min/dim) is a fixed
  // fact of the roman numeral itself, not something the choices need to test.
  document.getElementById('fb-keymap-degree-answers').innerHTML =
    FB_NOTE_NAMES.map(n => `<button class="fb-answer-btn" onclick="fbDegreeAnswer('${n}', this)">${n}</button>`).join('');

  const fb = document.getElementById('fb-keymap-degree-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
}

function fbDegreeAnswer(note, btnEl) {
  const s = fbState.keymap.degree;
  if (s.answered) return;
  s.answered = true;
  s.total++;
  const correct = FB_NOTE_NAMES.indexOf(note) === s.current.answerRootPc;
  if (correct) { s.correct++; s.streak++; } else { s.streak = 0; }
  btnEl.classList.add(correct ? 'correct' : 'wrong');

  const fb = document.getElementById('fb-keymap-degree-feedback');
  fb.textContent = correct ? `Correct — ${s.current.answer}` : `${s.current.answer} (you said ${note})`;
  fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
  fbRenderDegreeStats();
  setTimeout(fbDegreeNext, 900);
}


// ── Bend & Vibrato ──

// Exercise definitions: each entry gives a string (0=lowE…5=highE) and fret.
// Notes come from FB_STRING_OPEN_MIDI[string] + fret.
const FB_BEND_EXERCISES = [
  { string: 4, fret:  7 },  // B-str fret 7  = F#4
  { string: 4, fret:  9 },  // B-str fret 9  = G#4
  { string: 4, fret: 12 },  // B-str fret 12 = B4
  { string: 3, fret:  7 },  // G-str fret 7  = C#4
  { string: 3, fret:  9 },  // G-str fret 9  = Eb4
  { string: 3, fret: 12 },  // G-str fret 12 = G4
  { string: 5, fret:  9 },  // hiE-str fret 9  = C#5
  { string: 5, fret: 12 },  // hiE-str fret 12 = E5
];

const FB_BEND_STABLE_FRAMES   = 4;    // frames of stable pitch to lock baseline
const FB_BEND_HOLD_FRAMES     = 8;    // frames in target zone → success
const FB_BEND_TOLERANCE       = 25;   // cents around target → success
const FB_BEND_NEXT_DELAY_MS   = 2500;
const FB_BEND_HISTORY_MS      = 5000; // rolling graph window
const FB_BEND_SILENCE_HOLD_MS = 600;  // keep last reading for this long during decay

const FB_VIBRATO_HISTORY_MS    = 4000;
const FB_VIBRATO_SUCCESS_MS    = 3000;
const FB_VIBRATO_MIN_DEPTH     = 25;   // cents peak amplitude
const FB_VIBRATO_SUCCESS_FR    = 180;  // 3 s × ~60 fps

const FB_VIBRATO_TARGET_RANGES = { 3: [2, 4.5], 5: [3.5, 6.5], 7: [5.5, 9] };

const FB_STRING_DISPLAY = ['low E', 'A', 'D', 'G', 'B', 'high E'];

function fbBendNoteLabel(midi) {
  return FB_NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

function fbBendIntervalCents(interval) {
  return interval === 'half' ? 100 : interval === 'full' ? 200 : 300;
}

function fbBendIntervalLabel(interval) {
  return interval === 'half' ? '½ step' : interval === 'full' ? '1 full step' : '1½ steps';
}

function fbBendPickExercise() {
  const str = parseInt(fbState.bend.string);
  const pool = FB_BEND_EXERCISES.filter(e => e.string === str);
  const arr = pool.length ? pool : FB_BEND_EXERCISES;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Render helpers ──

function fbBendRenderOptions() {
  const s = fbState.bend;
  const el = document.getElementById('fb-bend-options');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-options">
      <label>String:
        <select onchange="fbState.bend.string=parseInt(this.value); fbPrefsSave(); fbBendNext()">
          <option value="3" ${+s.string===3?'selected':''}>G</option>
          <option value="4" ${+s.string===4?'selected':''}>B</option>
          <option value="5" ${+s.string===5?'selected':''}>high E</option>
        </select>
      </label>
      <label>Interval:
        <select onchange="fbState.bend.interval=this.value; fbPrefsSave(); fbBendNext()">
          <option value="half"      ${s.interval==='half'     ?'selected':''}>½ step</option>
          <option value="full"      ${s.interval==='full'     ?'selected':''}>1 full step</option>
          <option value="full_half" ${s.interval==='full_half'?'selected':''}>1½ steps</option>
        </select>
      </label>
    </div>`;
}

function fbVibratoRenderOptions() {
  const v = fbState.vibrato;
  const el = document.getElementById('fb-vibrato-options');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-options">
      <label>Target speed:
        <select onchange="fbState.vibrato.targetHz=parseInt(this.value); fbPrefsSave()">
          <option value="3" ${v.targetHz===3?'selected':''}>Slow (~3 Hz)</option>
          <option value="5" ${v.targetHz===5?'selected':''}>Medium (~5 Hz)</option>
          <option value="7" ${v.targetHz===7?'selected':''}>Fast (~7 Hz)</option>
        </select>
      </label>
    </div>`;
}

function fbBendRenderPrompt() {
  const s = fbState.bend;
  const c = s.current;
  if (!c) return;
  const el = document.getElementById('fb-bend-prompt');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-bend-exercise-row">
      <span class="fb-bend-location">${FB_STRING_DISPLAY[c.string]} string &nbsp;·&nbsp; fret ${c.fret}</span>
      <span class="fb-bend-arrow">→</span>
      <span class="fb-bend-intlabel">bend <strong>${c.intLabel}</strong></span>
    </div>
    <div class="fb-bend-notes-row">${c.startLabel} &nbsp;→&nbsp; <span class="fb-bend-target-note">${c.targetLabel}</span></div>`;
}

function fbBendRenderGraph() {
  const canvas = document.getElementById('fb-bend-canvas');
  if (!canvas) return;
  const s = fbState.bend;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const targetCents = s.current ? s.current.targetCents : 200;
  const maxCents    = targetCents + 60;
  const PAD_T = 20, PAD_B = 16, PAD_L = 0, PAD_R = 0;
  const innerH = H - PAD_T - PAD_B;

  // cents → canvas y (0¢ at bottom, maxCents at top)
  const cy = c => PAD_T + innerH - Math.max(0, Math.min(innerH, (Math.max(0, c) / maxCents) * innerH));

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8f7f0';
  ctx.fillRect(0, 0, W, H);

  // Target zone (green band)
  const yz1 = cy(targetCents + FB_BEND_TOLERANCE);
  const yz2 = cy(targetCents - FB_BEND_TOLERANCE);
  ctx.fillStyle = 'rgba(74,124,74,0.15)';
  ctx.fillRect(0, yz1, W, yz2 - yz1);

  // Target dashed line
  const yt = cy(targetCents);
  ctx.save();
  ctx.strokeStyle = '#4a7c4a';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(0, yt); ctx.lineTo(W, yt); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#4a7c4a';
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${targetCents}¢  ${s.current ? s.current.targetLabel : ''}`, 6, yt - 1);

  // Half-step guide (if target > 100¢)
  if (targetCents > 105) {
    const yh = cy(100);
    ctx.save();
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(0, yh); ctx.lineTo(W, yh); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#bbb';
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText('100¢', 6, yh - 1);
  }

  // Baseline
  const yb = cy(0);
  ctx.strokeStyle = '#6a8caa';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, yb); ctx.lineTo(W, yb); ctx.stroke();
  ctx.fillStyle = '#6a8caa';
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`0¢  ${s.current ? s.current.startLabel : ''}`, 6, yb + 2);

  if (!s._history || s._history.length < 2) return;

  // Pitch trace
  const now = performance.now();
  ctx.strokeStyle = '#b8843a';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let first = true;
  for (const { cents, ts } of s._history) {
    const x = PAD_L + (W - PAD_L - PAD_R) * (1 - (now - ts) / FB_BEND_HISTORY_MS);
    const y = cy(Math.max(-20, Math.min(maxCents, cents)));
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current dot
  const last = s._history[s._history.length - 1];
  if (last) {
    const inZone = Math.abs(last.cents - targetCents) <= FB_BEND_TOLERANCE;
    ctx.fillStyle = inZone ? '#27ae60' : '#b8843a';
    const dx = PAD_L + (W - PAD_L - PAD_R) * (1 - (now - last.ts) / FB_BEND_HISTORY_MS);
    const dy = cy(Math.max(-20, Math.min(maxCents, last.cents)));
    ctx.beginPath();
    ctx.arc(Math.min(W - 4, Math.max(4, dx)), dy, 5, 0, Math.PI * 2);
    ctx.fill();
    // Cents readout in top-right
    ctx.fillStyle = inZone ? '#27ae60' : '#2a2a2a';
    ctx.font = 'bold 14px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillText((last.cents >= 0 ? '+' : '') + last.cents + '¢', W - 8, 4);
    ctx.textAlign = 'left';
  }
}

function fbBendRenderStats() {
  const s = fbState.bend;
  const el = document.getElementById('fb-bend-stats');
  if (!el) return;
  const acc = s.total ? Math.round(s.correct / s.total * 100) + '%' : '—';
  el.innerHTML = `<span class="fb-stat-item">${s.correct}/${s.total}</span>
    <span class="fb-stat-item">streak ${s.streak}</span>
    <span class="fb-stat-item">acc ${acc}</span>`;
}

function fbBendFb(msg, cls) {
  const el = document.getElementById('fb-bend-feedback');
  if (el) { el.textContent = msg; el.className = 'fb-feedback ' + (cls || ''); }
}

// ── Lifecycle ──

function fbBendInit() {
  fbBendSetSubMode(fbState.bend.subMode, false);
}

function fbBendSetSubMode(mode, save = true) {
  fbState.bend.subMode = mode;
  if (save) fbPrefsSave();
  document.querySelectorAll('#fb-bend .fb-subtab').forEach(b =>
    b.classList.toggle('active', b.dataset.bendmode === mode));
  document.getElementById('fb-bend-bend-panel').style.display    = mode === 'bend'    ? '' : 'none';
  document.getElementById('fb-bend-vibrato-panel').style.display  = mode === 'vibrato' ? '' : 'none';
  if (fbMic.listening && fbMic.owner === 'bend') fbBendMicStop();
  fbBendRenderOptions();
  fbVibratoRenderOptions();
  if (mode === 'bend')    fbBendNext();
  if (mode === 'vibrato') fbVibratoNext();
}

function fbBendNext() {
  const s = fbState.bend;
  s.phase = 'idle';
  s.baseFreq = null;
  s._stableFr = 0;
  s._holdFr = 0;
  s._lastFreq = null;
  s._nextAt = null;
  s._history = [];
  s._lastFreqTs = null;
  s._smoothedCents = null;
  const ex = fbBendPickExercise();
  const midi = FB_STRING_OPEN_MIDI[ex.string] + ex.fret;
  const targetCents = fbBendIntervalCents(s.interval);
  const targetMidi  = midi + Math.round(targetCents / 100);
  s.current = {
    string: ex.string, fret: ex.fret,
    startLabel: fbBendNoteLabel(midi),
    targetLabel: fbBendNoteLabel(targetMidi),
    targetCents, intLabel: fbBendIntervalLabel(s.interval),
  };
  fbBendRenderPrompt();
  fbBendRenderGraph();
  fbBendRenderStats();
  fbBendFb(fbMic.owner === 'bend' ? 'Pluck the string…' : '', '');
}

async function fbBendMicStart() {
  try {
    await fbMicStart('bend', fbBendOnFrame);
  } catch (e) {
    fbBendFb('Mic error: ' + e.message, 'err');
    return;
  }
  if (fbState.bend.subMode === 'bend') {
    // Reset detection state so each listening session starts fresh
    fbState.bend.phase    = 'pluck';
    fbState.bend.baseFreq = null;
    fbState.bend._stableFr = 0;
    fbState.bend._lastFreq = null;
    fbState.bend._holdFr   = 0;
    fbState.bend._history  = [];
    fbState.bend._lastFreqTs = null;
    fbState.bend._smoothedCents = null;
    fbBendFb('Pluck the string — then bend…', '');
    fbBendRenderGraph();
  } else {
    fbState.vibrato.phase = 'pluck';
    document.getElementById('fb-vibrato-feedback').textContent = 'Pluck any note and apply vibrato…';
    document.getElementById('fb-vibrato-feedback').className = 'fb-feedback';
  }
  fbSyncMicButtons('bend');
}

function fbBendMicStop() {
  fbMicStop();
  fbState.bend.phase = 'idle';
  fbState.vibrato.phase = 'idle';
  fbBendRenderGraph();
  fbSyncMicButtons('bend');
}

// ── onFrame dispatcher ──

function fbBendOnFrame(analyser, sampleRate) {
  if (fbState.bend.subMode === 'vibrato') {
    fbVibratoOnFrame(analyser, sampleRate);
  } else {
    fbBendBendOnFrame(analyser, sampleRate);
  }
}

// ── Bending onFrame ──

function fbBendBendOnFrame(analyser, sampleRate) {
  const s = fbState.bend;
  const now = performance.now();

  // Auto-advance after success
  if (s._nextAt && now >= s._nextAt) {
    s._nextAt = null;
    fbBendNext();
    return;
  }

  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  // Use a lower RMS threshold (0.003 vs default 0.01) so decaying notes
  // during bending are still detected rather than discarded as silence.
  const freq = fbAutoCorrelate(buf, sampleRate, 0.003);
  const hasSignal = freq > 60 && freq < 2000;

  if (hasSignal) {
    s._lastFreqTs = now;

    if (!s.baseFreq) {
      // ── Phase 1: lock baseline ──
      // Accumulate N frames with < 25¢ pitch drift to confirm the note is stable.
      if (s._lastFreq) {
        const delta = Math.abs(1200 * Math.log2(freq / s._lastFreq));
        if (delta < 25) s._stableFr++;
        else            s._stableFr = 0;
      } else {
        s._stableFr = 1;
      }
      s._lastFreq = freq;
      if (s._stableFr >= FB_BEND_STABLE_FRAMES) {
        s.baseFreq      = s._lastFreq;
        s.phase         = 'bending';
        s._history      = [];
        s._holdFr       = 0;
        s._lastFreq     = null;
        s._stableFr     = 0;
        s._smoothedCents = 0;
        fbBendFb('Got it — now bend up!', '');
      }
    } else {
      // ── Phase 2: measure & smooth ──
      const rawCents = 1200 * Math.log2(freq / s.baseFreq);
      // EMA smoothing (α=0.4): keeps the curve fluid while tracking the bend.
      // Lower α → smoother but more lag; 0.4 gives ~80 ms lag at 60 fps.
      s._smoothedCents = (s._smoothedCents === null)
        ? rawCents
        : 0.6 * s._smoothedCents + 0.4 * rawCents;
      s._recordCents(now);
    }
  } else if (s.baseFreq && s._lastFreqTs !== null) {
    // ── Silence window ──
    // A decaying bent note goes quiet before the bend position is released.
    // Keep the smoothed value alive for up to SILENCE_HOLD_MS so the hold
    // counter can still accumulate during the quieter tail of the note.
    const sinceMs = now - s._lastFreqTs;
    if (sinceMs < FB_BEND_SILENCE_HOLD_MS && s._smoothedCents !== null) {
      s._recordCents(now);  // freeze last smoothed value — bend still held
    }
  }

  if (s.baseFreq) fbBendRenderGraph();
}

// Shared helper: push current smoothedCents into history, trim window,
// and advance the hold counter / check success.  Called from both the
// active-signal and silence-hold branches so both count toward success.
fbState.bend._recordCents = function(now) {
  const s = fbState.bend;
  const cents = Math.round(s._smoothedCents);
  s._history.push({ cents, ts: now });
  const cutoff = now - FB_BEND_HISTORY_MS;
  while (s._history.length > 0 && s._history[0].ts < cutoff) s._history.shift();

  if (s.phase === 'success') return;

  const inZone = Math.abs(cents - s.current.targetCents) <= FB_BEND_TOLERANCE;
  if (inZone) {
    s._holdFr++;
    if (s._holdFr >= FB_BEND_HOLD_FRAMES) {
      s.phase = 'success';
      s.correct++; s.total++; s.streak++;
      fbBendFb('✓ Perfect bend!', 'ok');
      fbBendRenderStats();
      s._nextAt = now + FB_BEND_NEXT_DELAY_MS;
    }
  } else {
    // Decay slowly so short excursions don't reset all progress.
    s._holdFr = Math.max(0, s._holdFr - 2);
  }
};

// ── Vibrato ──

function fbVibratoNext() {
  const v = fbState.vibrato;
  v.phase = 'idle';
  v.baseFreq = null;
  v._history = [];
  v._stableFr = 0;
  v._lastFreq = null;
  v._successFr = 0;
  v._startTime = null;
  v.speed = null;
  v.depth = null;
  const fb = document.getElementById('fb-vibrato-feedback');
  if (fb) { fb.textContent = fbMic.owner === 'bend' ? 'Pluck any note and apply vibrato…' : ''; fb.className = 'fb-feedback'; }
  fbVibratoRenderWaveform();
  fbVibratoRenderReadout(null, null);
  fbVibratoRenderProgress(0);
  fbVibratoRenderStats();
}

function fbVibratoOnFrame(analyser, sampleRate) {
  const v = fbState.vibrato;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  if (!(freq > 60 && freq < 2000)) return;

  if (v.phase === 'pluck') {
    if (!v._lastFreq) { v._lastFreq = freq; return; }
    const delta = Math.abs(1200 * Math.log2(freq / v._lastFreq));
    v._lastFreq = freq;
    if (delta < 40) {
      v._stableFr++;
      if (v._stableFr >= FB_BEND_STABLE_FRAMES) {
        v.baseFreq = freq;
        v.phase = 'sustain';
        v._history = [];
        v._successFr = 0;
        v._startTime = performance.now();
        const fb = document.getElementById('fb-vibrato-feedback');
        if (fb) { fb.textContent = 'Now apply vibrato!'; fb.className = 'fb-feedback'; }
      }
    } else {
      v._stableFr = 0;
    }
    return;
  }

  if (v.phase === 'sustain' || v.phase === 'success') {
    const now  = performance.now();
    const cents = Math.round(1200 * Math.log2(freq / v.baseFreq));
    v._history.push({ cents, ts: now });
    // Trim to window
    const cutoff = now - FB_VIBRATO_HISTORY_MS;
    while (v._history.length > 0 && v._history[0].ts < cutoff) v._history.shift();

    fbVibratoRenderWaveform();

    const { speed, depth } = fbVibratoAnalyze(v._history);
    v.speed = speed;
    v.depth = depth;
    fbVibratoRenderReadout(speed, depth);

    if (v.phase === 'success') return;  // stay in success until next()

    const [lo, hi] = FB_VIBRATO_TARGET_RANGES[v.targetHz] || FB_VIBRATO_TARGET_RANGES[5];
    const ok = speed >= lo && speed <= hi && depth >= FB_VIBRATO_MIN_DEPTH;
    if (ok) {
      v._successFr++;
      fbVibratoRenderProgress(v._successFr / FB_VIBRATO_SUCCESS_FR);
      if (v._successFr >= FB_VIBRATO_SUCCESS_FR) {
        v.phase = 'success';
        v.correct++; v.total++;
        const fb = document.getElementById('fb-vibrato-feedback');
        if (fb) { fb.textContent = '✓ Great vibrato!'; fb.className = 'fb-feedback ok'; }
        fbVibratoRenderStats();
        setTimeout(() => { if (fbMic.listening && fbMic.owner === 'bend') fbVibratoNext(); }, 2000);
      }
    } else {
      v._successFr = Math.max(0, v._successFr - 1);
      fbVibratoRenderProgress(v._successFr / FB_VIBRATO_SUCCESS_FR);
    }
  }
}

function fbVibratoAnalyze(history) {
  if (history.length < 8) return { speed: 0, depth: 0 };
  const vals    = history.map(h => h.cents);
  const mean    = vals.reduce((a, b) => a + b, 0) / vals.length;
  const centered = vals.map(v => v - mean);
  const depth   = Math.round((Math.max(...centered) - Math.min(...centered)) / 2);
  let crossings = 0;
  for (let i = 1; i < centered.length; i++) {
    if (centered[i - 1] * centered[i] < 0) crossings++;
  }
  const durSec = (history[history.length - 1].ts - history[0].ts) / 1000;
  const speed  = durSec > 0.3 ? Math.round(crossings / 2 / durSec * 10) / 10 : 0;
  return { speed, depth };
}

function fbVibratoRenderWaveform() {
  const canvas = document.getElementById('fb-vibrato-canvas');
  if (!canvas) return;
  const v   = fbState.vibrato;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const CENTS_RANGE = 150;  // ±150¢ displayed
  const cy2 = c => H / 2 - (c / CENTS_RANGE) * (H / 2 - 4);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8f7f0';
  ctx.fillRect(0, 0, W, H);

  // ±50¢ green zone
  const y50 = cy2(50), y50n = cy2(-50);
  ctx.fillStyle = 'rgba(74,124,74,0.1)';
  ctx.fillRect(0, y50, W, y50n - y50);

  // Dashed center
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  ctx.setLineDash([]);

  if (v._history.length < 2) return;

  const now = performance.now();
  ctx.strokeStyle = '#4a7c4a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let first = true;
  for (const { cents, ts } of v._history) {
    const x = W - (now - ts) / FB_VIBRATO_HISTORY_MS * W;
    const y = cy2(Math.max(-CENTS_RANGE, Math.min(CENTS_RANGE, cents)));
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current dot
  const last = v._history[v._history.length - 1];
  if (last) {
    ctx.fillStyle = '#b8843a';
    ctx.beginPath();
    ctx.arc(W - 2, cy2(Math.max(-CENTS_RANGE, Math.min(CENTS_RANGE, last.cents))), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fbVibratoRenderReadout(speed, depth) {
  const el = document.getElementById('fb-vibrato-readout');
  if (!el) return;
  if (speed !== null) {
    el.innerHTML = `<span class="fb-vib-stat">Speed: <strong>${speed} Hz</strong></span>
      &nbsp;·&nbsp; <span class="fb-vib-stat">Depth: <strong>±${depth}¢</strong></span>`;
  } else {
    el.innerHTML = '<span style="color:#aaa">listening…</span>';
  }
}

function fbVibratoRenderProgress(frac) {
  const el = document.getElementById('fb-vibrato-progress');
  if (!el) return;
  const pct  = Math.round(Math.min(1, frac) * 100);
  const secs = (frac * FB_VIBRATO_SUCCESS_MS / 1000).toFixed(1);
  el.innerHTML = `<div class="fb-vibrato-prog-bar"><div class="fb-vibrato-prog-fill" style="width:${pct}%"></div></div>
    <span class="fb-vibrato-prog-label">${secs} / ${FB_VIBRATO_SUCCESS_MS / 1000}s</span>`;
}

function fbVibratoRenderStats() {
  const v  = fbState.vibrato;
  const el = document.getElementById('fb-vibrato-stats');
  if (!el) return;
  el.innerHTML = `<span class="fb-stat-item">${v.correct}/${v.total} sessions completed</span>`;
}

// ── Guard action buttons against rapid double-click ──
// Answer functions (fbNotesAnswer, fbEarTwoAnswer, etc.) already have an
// internal `locked`/`answered` flag — only the bare "Next" and "Play"
// functions need wrapping here.
fbCagedNext               = guarded(fbCagedNext);
fbNotesNext               = guarded(fbNotesNext);
fbShapeDegreeIdentifyNext = guarded(fbShapeDegreeIdentifyNext);
fbShapeDegreeLocateNext   = guarded(fbShapeDegreeLocateNext);
fbEarManualNext           = guarded(fbEarManualNext);
fbEarPlayCurrent          = guarded(fbEarPlayCurrent);
fbEarPlayScaffold         = guarded(fbEarPlayScaffold);
fbPitchNewNote            = guarded(fbPitchNewNote);
fbChordNewChord           = guarded(fbChordNewChord);
fbRelativeNext            = guarded(fbRelativeNext);
fbDegreeNext              = guarded(fbDegreeNext);

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fbState,
    fbNoteAt, fbFreqFromMidi, fbOctaveOf,
    fbBarreFretForShape, fbBarreFretFor,
    fbStringMidis, fbPitchAllowedMidis,
    fbChordFormula, fbChordDisplaySymbol,
    fbFreqToNote, fbAutoCorrelate,
    fbDegreeChordName,
    FB_CAGED_SHAPES, fbShapeDegreeLabels, fbShapePositionsForShape, fbShapeDegreeSetup,
    FB_EAR_SCALES, fbEarIntervalName, fbEarPossibleIntervals, fbEarAdjacentIntervals, fbEarPickOrder,
    FB_EAR_RANGE_BASE, FB_EAR_INTERVAL_HINTS,
    FB_CHORD_PROGRESSIONS, fbChordBestQualityFor, fbChordEligibleProgressions, fbChordBuildProgressionChords,
    fbBendIntervalCents, fbBendNoteLabel,
    fbVibratoAnalyze,
    fbChordPickTargetFixedRoot,
  };
}
